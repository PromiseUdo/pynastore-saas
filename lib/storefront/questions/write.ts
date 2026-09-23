/*
 * lib/storefront/questions/write.ts
 *
 * A shopper asking a question about a product.
 *
 * The browser sends words and a product id. It does not send who is asking
 * or which store this is: the customer comes from the session cookie and the
 * organization from that same session, so the worst a doctored form can do
 * is ask about a product id — and a product id that isn't this store's is a
 * miss, not a leak, because the insert names both.
 *
 * Nothing written here is public. A question waits as PENDING until the
 * merchant answers it (features/sales/questions.ts), which is what keeps an
 * open text box on a product page from being a place to publish anything.
 */
import { prisma } from '@/lib/prisma';
import { validateQuestion } from './rules';

export type AskFailure = 'invalid' | 'unknown-product' | 'duplicate' | 'failed';

export type AskResult =
  | { ok: true; questionId: string }
  | { ok: false; code: AskFailure; message: string };

/** A shopper only has so many open questions about one product worth having. */
const MAX_PENDING_PER_PRODUCT = 3;

export async function askQuestion(input: {
  organizationId: string;
  customerId: string;
  productId: string;
  body: string;
}): Promise<AskResult> {
  const checked = validateQuestion(input.body);
  if (!checked.ok) return { ok: false, code: 'invalid', message: checked.message };

  /* The product has to be this store's. Asking about someone else's id is
   * the only thing a tampered form could try, and it ends here. */
  const product = await prisma.inventoryItem.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!product) {
    return { ok: false, code: 'unknown-product', message: 'We couldn’t find that product.' };
  }

  const waiting = await prisma.productQuestion.count({
    where: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      productId: input.productId,
      status: 'PENDING',
    },
  });
  if (waiting >= MAX_PENDING_PER_PRODUCT) {
    return {
      ok: false,
      code: 'duplicate',
      message: 'You already have questions waiting on this product. We’ll answer those first.',
    };
  }

  try {
    const question = await prisma.productQuestion.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        customerId: input.customerId,
        body: checked.value,
      },
      select: { id: true },
    });
    return { ok: true, questionId: question.id };
  } catch (error) {
    console.error('[questions] Could not save question:', error);
    return { ok: false, code: 'failed', message: 'We couldn’t send your question. Please try again.' };
  }
}
