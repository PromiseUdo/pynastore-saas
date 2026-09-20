'use server';

/*
 * features/shop-reviews/actions.ts
 *
 * What a signed-in shopper does with reviews: write one, change it, take it
 * down, and say that someone else's helped.
 *
 * Storefront pages are rendered per request, so there is no cache to bust
 * here: the form calls `router.refresh()` once an action succeeds and the
 * page comes back with the review, and the new average, on it.
 *
 * The store comes from the request header and the shopper from the session
 * cookie — neither from the form. The one thing the form supplies about
 * identity is the product being reviewed, and lib/storefront/reviews/read.ts
 * answers separately whether this account actually received it. So the worst
 * a doctored form can do is ask to review something the person bought.
 */
import { checkRateLimit } from '@/lib/rate-limit';
import { currentStoreSlug, getShopper } from '@/lib/storefront/account/session';
import { deleteOwnReview, submitReview, toggleHelpful } from '@/lib/storefront/reviews/write';

export type ReviewFormState = {
  error?: string;
  fieldErrors?: Partial<Record<'rating' | 'title' | 'body', string>>;
  values?: { rating?: string; title?: string; body?: string };
  message?: string;
} | null;

const NOT_SIGNED_IN = 'Your session has ended. Please sign in again to leave a review.';

export async function submitReviewAction(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const [storeSlug, shopper] = await Promise.all([currentStoreSlug(), getShopper()]);
  if (!storeSlug || !shopper) return { error: NOT_SIGNED_IN };

  const productId = String(formData.get('productId') ?? '');
  const rating = String(formData.get('rating') ?? '');
  const title = String(formData.get('title') ?? '');
  const body = String(formData.get('body') ?? '');
  const values = { rating, title, body };

  if (!productId) return { error: 'We couldn’t tell which product this is about.', values };

  /* One person writing about what they bought does this once or twice. A
   * burst is a script, and each one of these is a public piece of writing. */
  if (!checkRateLimit(`review:${shopper.id}`, 10, 60 * 60 * 1000)) {
    return { error: 'That’s a lot of reviews at once. Please try again a little later.', values };
  }

  const result = await submitReview({
    organizationId: shopper.organizationId,
    customerId: shopper.id,
    productId,
    rating: Number(rating),
    title,
    body,
  });

  if (!result.ok) {
    return { error: result.message, fieldErrors: result.fieldErrors, values };
  }

  return {
    message: result.created
      ? 'Thanks — your review is on the product page.'
      : 'Your review has been updated.',
  };
}

export async function deleteReviewAction(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const shopper = await getShopper();
  if (!shopper) return { error: NOT_SIGNED_IN };

  const productId = String(formData.get('productId') ?? '');
  if (!productId) return { error: 'We couldn’t tell which review to remove.' };

  const { ok } = await deleteOwnReview({
    organizationId: shopper.organizationId,
    customerId: shopper.id,
    productId,
  });
  if (!ok) return { error: 'We couldn’t find that review on your account.' };

  return { message: 'Your review has been removed.' };
}

export type HelpfulResult =
  | { ok: true; helpful: number; voted: boolean }
  | { ok: false; message: string };

export async function markHelpfulAction(reviewId: string): Promise<HelpfulResult> {
  const shopper = await getShopper();
  if (!shopper) return { ok: false, message: 'Sign in to say a review helped you.' };

  if (!checkRateLimit(`review-helpful:${shopper.id}`, 60, 60 * 60 * 1000)) {
    return { ok: false, message: 'Please slow down a moment.' };
  }

  return toggleHelpful({
    organizationId: shopper.organizationId,
    customerId: shopper.id,
    reviewId,
  });
}
