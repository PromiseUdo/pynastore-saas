/*
 * lib/storefront/reviews/write.ts
 *
 * Writing a review, changing it, taking it down, and saying one helped.
 *
 * The browser sends a rating and some words. It does not send who wrote it,
 * which product it is about being enough to prove anything, or whether the
 * purchase happened: the customer comes from the session cookie, and the
 * entitlement is re-read here from the merchant's orders (./read.ts) on
 * every write. A review that trusted the form about its own verification
 * would be a review anyone could plant.
 */
import { prisma } from '@/lib/prisma';
import { reviewOpportunity } from './read';
import { validateReview, type ReviewDraft } from './rules';

export type SubmitFailure = 'not-purchased' | 'invalid' | 'failed';

export type SubmitResult =
  | { ok: true; reviewId: string; created: boolean }
  | { ok: false; code: SubmitFailure; message: string; fieldErrors?: Record<string, string> };

export interface SubmitReviewInput extends ReviewDraft {
  organizationId: string;
  customerId: string;
  productId: string;
}

const NOT_PURCHASED =
  'Reviews come from delivered orders, and we can’t find one for this product on your account.';

/**
 * Write the shopper's review of a product, or replace the one they wrote
 * before. One person, one product, one opinion — the second one edits the
 * first rather than adding to the average twice.
 */
export async function submitReview(input: SubmitReviewInput): Promise<SubmitResult> {
  const checked = validateReview(input);
  if (!checked.ok) {
    return {
      ok: false,
      code: 'invalid',
      message: 'Please check the fields below.',
      fieldErrors: checked.fieldErrors,
    };
  }

  const opportunity = await reviewOpportunity(input);
  if (!opportunity.canReview || !opportunity.orderId) {
    return { ok: false, code: 'not-purchased', message: NOT_PURCHASED };
  }

  const { rating, title, body } = checked.value;

  try {
    const review = await prisma.productReview.upsert({
      where: { customerId_productId: { customerId: input.customerId, productId: input.productId } },
      create: {
        organizationId: input.organizationId,
        productId: input.productId,
        customerId: input.customerId,
        orderId: opportunity.orderId,
        rating,
        title,
        body,
      },
      /* An edited review goes back on the storefront: the merchant hid what
       * was there before, and this is different text. Its helpful votes go
       * with the old words, so they are cleared with them. */
      update: { rating, title, body, status: 'PUBLISHED', hiddenReason: null, hiddenAt: null, helpfulCount: 0 },
      select: { id: true },
    });

    if (opportunity.own) {
      await prisma.productReviewVote.deleteMany({ where: { reviewId: review.id } });
    }

    return { ok: true, reviewId: review.id, created: !opportunity.own };
  } catch (error) {
    console.error('[reviews] Could not save review:', error);
    return { ok: false, code: 'failed', message: 'We couldn’t save your review. Please try again.' };
  }
}

/** Take down one's own review. Scoped by customer, so it can only ever be one's own. */
export async function deleteOwnReview(input: {
  organizationId: string;
  customerId: string;
  productId: string;
}): Promise<{ ok: boolean }> {
  const { count } = await prisma.productReview.deleteMany({
    where: { organizationId: input.organizationId, customerId: input.customerId, productId: input.productId },
  });
  return { ok: count > 0 };
}

export type VoteResult = { ok: true; helpful: number; voted: boolean } | { ok: false; message: string };

/**
 * "This was helpful", and pressing it again to take it back.
 *
 * The count is derived from the votes in the same transaction rather than
 * incremented, so a double submission can't drift it away from the number of
 * people who actually pressed it. A shopper cannot vote for their own.
 */
export async function toggleHelpful(input: {
  organizationId: string;
  customerId: string;
  reviewId: string;
}): Promise<VoteResult> {
  const review = await prisma.productReview.findFirst({
    where: { id: input.reviewId, organizationId: input.organizationId, status: 'PUBLISHED' },
    select: { id: true, customerId: true },
  });
  if (!review) return { ok: false, message: 'That review is no longer available.' };
  if (review.customerId === input.customerId) {
    return { ok: false, message: 'You can’t mark your own review as helpful.' };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.productReviewVote.findUnique({
        where: { reviewId_customerId: { reviewId: review.id, customerId: input.customerId } },
        select: { id: true },
      });

      if (existing) await tx.productReviewVote.delete({ where: { id: existing.id } });
      else await tx.productReviewVote.create({ data: { reviewId: review.id, customerId: input.customerId } });

      const helpful = await tx.productReviewVote.count({ where: { reviewId: review.id } });
      await tx.productReview.update({ where: { id: review.id }, data: { helpfulCount: helpful } });

      return { ok: true as const, helpful, voted: !existing };
    });
  } catch (error) {
    console.error('[reviews] Could not record helpful vote:', error);
    return { ok: false, message: 'We couldn’t record that. Please try again.' };
  }
}
