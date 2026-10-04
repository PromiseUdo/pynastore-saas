/*
 * "What customers say" (ROADMAP 15.4): recent published reviews of 4 or 5
 * stars, each from a customer whose order was delivered, with the product it
 * is about. The subtitle says exactly that, so the section never implies
 * every review is glowing. Nothing here is written for the merchant, and with
 * no such reviews the section isn't shown at all.
 *
 * Server component.
 */
import Link from 'next/link';
import { BadgeCheck, Star } from 'lucide-react';
import type { StoreReview } from '@/lib/storefront/catalog';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function StoreReviews({ reviews }: { reviews: StoreReview[] }) {
  if (!reviews.length) return null;
  return (
    <section className="sf-container sf-section">
      <SectionHeader
        title="What customers say"
        subtitle="Recent 4- and 5-star reviews from customers whose orders were delivered."
      />
      <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {reviews.map((review) => (
          <li key={review.id} className="flex flex-col rounded-2xl border bg-card p-5">
            <p className="flex gap-0.5" aria-label={`Rated ${review.rating} out of 5`}>
              {Array.from({ length: 5 }, (_, i) => (
                <Star
                  key={i}
                  aria-hidden
                  className={i < review.rating ? 'size-4 fill-rating text-rating' : 'size-4 text-border'}
                />
              ))}
            </p>
            {review.title && <p className="mt-3 font-semibold">{review.title}</p>}
            <p className="mt-2 line-clamp-5 text-sm leading-relaxed text-muted-foreground">{review.body}</p>
            <div className="mt-auto pt-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                {review.author}
                <span className="inline-flex items-center gap-1 font-normal text-success">
                  <BadgeCheck className="size-3.5" aria-hidden />
                  Verified purchase
                </span>
              </p>
              <Link href={`/products/${review.product.slug}`} className="mt-1 block truncate hover:text-foreground">
                on {review.product.name}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
