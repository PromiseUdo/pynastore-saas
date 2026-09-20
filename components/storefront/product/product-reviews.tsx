/*
 * Reviews: the summary, the distribution, the reviews themselves, and — for
 * a shopper who has actually received this product — the form to write one.
 *
 * Server component. The distribution bars are computed from the product's
 * own rating distribution — the percentages are derived, never authored, so
 * they always add up and always match the average printed beside them.
 *
 * WHO GETS A FORM is decided on the server, from the merchant's orders
 * (lib/storefront/reviews/read.ts): only an account with a delivered order
 * containing this product. Everyone else is told that plainly, because "only
 * people who bought it can review it" is the reason these reviews are worth
 * reading.
 */
import { BadgeCheck } from 'lucide-react';
import Link from 'next/link';
import { RatingStars } from '@/components/storefront/common/rating-stars';
import { ReviewList } from './review-list';
import { ReviewForm } from './review-form';
import { ReviewHelpfulButton } from './review-helpful-button';
import { formatDate } from '@/lib/storefront/format';
import type { OwnReview } from '@/lib/storefront/reviews/read';
import type { Product, Review } from '@/lib/storefront/types';

export interface ReviewViewer {
  /** the viewer bought this product and may write about it */
  canReview: boolean;
  /** what they already wrote, if anything */
  own: OwnReview | null;
  /** reviews on this page they've already found helpful */
  votedIds: string[];
  signedIn: boolean;
}

export function ProductReviews({
  product,
  reviews,
  total,
  viewer,
}: {
  product: Product;
  reviews: Review[];
  total: number;
  viewer: ReviewViewer;
}) {
  const { average, count, distribution } = product.rating;
  const stars = [5, 4, 3, 2, 1] as const;
  const voted = new Set(viewer.votedIds);

  const invite = <ReviewInvite product={product} viewer={viewer} />;

  /* No ratings yet: say so. A 0.0 out of five with an empty bar chart reads
   * as a terrible product rather than a new one. */
  if (count === 0) {
    return (
      <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
        <h2 id="reviews-heading" className="font-display text-2xl">
          Reviews
        </h2>
        <p className="mt-4 max-w-prose text-sm text-muted-foreground">
          {viewer.canReview
            ? 'No reviews yet — yours would be the first.'
            : 'No reviews yet. Once customers who’ve bought this product review it, their ratings will appear here.'}
        </p>
        <div className="mt-5 max-w-xl">{invite}</div>
      </section>
    );
  }

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
      <h2 id="reviews-heading" className="font-display text-2xl">
        Reviews
      </h2>

      <div className="mt-6 grid gap-8 lg:grid-cols-[18rem_1fr] lg:gap-12">
        {/* ── summary ─────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-4">
            <p className="text-5xl font-bold tabular-nums">{average.toFixed(1)}</p>
            <div>
              <RatingStars value={average} size={18} />
              <p className="mt-1 text-xs text-muted-foreground">
                {count.toLocaleString()} {count === 1 ? 'rating' : 'ratings'}
              </p>
            </div>
          </div>

          <ul className="mt-5 space-y-2">
            {stars.map((star) => {
              const n = distribution[star] ?? 0;
              const pct = count > 0 ? Math.round((n / count) * 100) : 0;
              return (
                <li key={star} className="flex items-center gap-3 text-xs">
                  <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{star} ★</span>
                  <span
                    className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
                    role="img"
                    aria-label={`${star} stars: ${pct}% of ratings`}
                  >
                    <span className="block h-full rounded-full bg-rating" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
            <BadgeCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
            Every review here was written by a customer of this store after their order was
            delivered.
          </p>

          <div className="mt-5">{invite}</div>
        </div>

        {/* ── the reviews ─────────────────────────────────────────── */}
        <div className="min-w-0">
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No written reviews for this product yet.
            </p>
          ) : (
            <ReviewList
              total={total}
              reviews={reviews.map((review) => (
                <ReviewItem
                  key={review.id}
                  review={review}
                  isOwn={review.id === viewer.own?.id}
                  voted={voted.has(review.id)}
                />
              ))}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The one slot that changes with who's reading: the form, an invitation to
 * sign in, or an explanation of why there's no form. Never a form that would
 * be refused on submit.
 */
function ReviewInvite({ product, viewer }: { product: Product; viewer: ReviewViewer }) {
  if (viewer.canReview) {
    return (
      <ReviewForm
        productId={product.id}
        productName={product.name}
        own={viewer.own}
      />
    );
  }

  if (!viewer.signedIn) {
    return (
      <p className="text-sm text-muted-foreground">
        Bought this from us?{' '}
        <Link
          href={`/account/sign-in?next=${encodeURIComponent(`/products/${product.slug}`)}`}
          className="font-semibold text-foreground underline underline-offset-2"
        >
          Sign in
        </Link>{' '}
        to review it.
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Reviews come from delivered orders, so you can write one once this product has arrived.
    </p>
  );
}

function ReviewItem({
  review,
  isOwn,
  voted,
}: {
  review: Review;
  isOwn: boolean;
  voted: boolean;
}) {
  return (
    <article className="border-b pb-6 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RatingStars value={review.rating} size={14} />
        <h3 className="text-sm font-semibold">{review.title}</h3>
        {isOwn && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] font-semibold">
            Your review
          </span>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
        {review.body}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{review.author}</span>
        <span aria-hidden>·</span>
        <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
        {review.verified && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 text-success">
              <BadgeCheck aria-hidden className="size-3.5" />
              Verified purchase
            </span>
          </>
        )}
        <ReviewHelpfulButton
          reviewId={review.id}
          helpful={review.helpful}
          voted={voted}
          isOwn={isOwn}
        />
      </div>
    </article>
  );
}
