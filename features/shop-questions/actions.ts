'use server';

/*
 * features/shop-questions/actions.ts
 *
 * A signed-in shopper asking the store a question about a product.
 *
 * The store comes from the session cookie and so does the shopper — the form
 * supplies only the product it is about, and lib/storefront/questions/write.ts
 * checks that product belongs to this store before anything is written.
 *
 * Nothing this action writes is public. The answer is the publishing step,
 * and only the merchant can take it (features/sales/questions.ts), so an
 * open box on a product page can't be used to put words on someone's store.
 */
import { checkRateLimit } from '@/lib/rate-limit';
import { getShopper } from '@/lib/storefront/account/session';
import { askQuestion } from '@/lib/storefront/questions/write';

export type QuestionFormState = {
  error?: string;
  values?: { body?: string };
  message?: string;
} | null;

const NOT_SIGNED_IN = 'Your session has ended. Please sign in again to ask a question.';

export async function askQuestionAction(
  _prev: QuestionFormState,
  formData: FormData,
): Promise<QuestionFormState> {
  const shopper = await getShopper();
  if (!shopper) return { error: NOT_SIGNED_IN };

  const productId = String(formData.get('productId') ?? '');
  const body = String(formData.get('body') ?? '');
  const values = { body };

  if (!productId) return { error: 'We couldn’t tell which product this is about.', values };

  /* Someone deciding on a purchase asks once or twice. A burst is a script,
   * and each of these lands in a merchant's inbox. */
  if (!checkRateLimit(`question:${shopper.id}`, 10, 60 * 60 * 1000)) {
    return { error: 'That’s a lot of questions at once. Please try again a little later.', values };
  }

  const result = await askQuestion({
    organizationId: shopper.organizationId,
    customerId: shopper.id,
    productId,
    body,
  });

  if (!result.ok) return { error: result.message, values };

  return {
    message: 'Thanks — your question is with the store team. We’ll answer it on this page.',
  };
}
