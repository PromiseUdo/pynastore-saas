/*
 * "How did these work out?" — the delivered products this shopper hasn't
 * reviewed yet.
 *
 * It sits above the order list because that is where someone already is when
 * they think about what arrived. Each item links to its own product page,
 * where the form lives: one place writes a review, not two.
 *
 * Shown only when there is something to review. A permanent nag on an
 * account with nothing outstanding is just furniture.
 */
import Image from 'next/image';
import Link from 'next/link';
import { Star } from 'lucide-react';

export interface ReviewPromptItem {
  productId: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
}

export function ReviewPrompt({ items }: { items: ReviewPromptItem[] }) {
  const reviewable = items.filter((item) => item.slug);
  if (reviewable.length === 0) return null;

  return (
    <section
      aria-labelledby="review-prompt-heading"
      className="rounded-3xl border border-border bg-secondary/50 p-4 sm:p-5"
    >
      <h2 id="review-prompt-heading" className="flex items-center gap-2 font-display text-base">
        <Star aria-hidden className="size-4 fill-rating text-rating" />
        How did these work out?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You’ve received these. A few words from you helps the next shopper decide.
      </p>

      <ul className="mt-4 space-y-2">
        {reviewable.map((item) => (
          <li key={item.productId}>
            <Link
              href={`/products/${item.slug}#reviews`}
              className="flex items-center gap-3 rounded-2xl bg-card p-2.5 transition-colors hover:bg-card/70"
            >
              <span className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-secondary">
                {item.imageUrl && (
                  <Image src={item.imageUrl} alt="" fill sizes="48px" className="object-cover" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
              <span className="shrink-0 text-sm font-semibold text-brand">Write a review</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
