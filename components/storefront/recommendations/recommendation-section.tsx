'use client';

/*
 * A recommendation block — presentational.
 *
 * Same visual language as <HighlightRail> (a flickable overflow rail on a
 * phone, a row on desktop) and the SAME <ProductCard> every other surface
 * uses, so a recommended product opens, adds to bag and wishlists exactly
 * like any other (§28). What this adds over HighlightRail is the states a
 * request-backed block needs:
 *
 *   loading  → card skeletons in the rail's own footprint (no layout jump)
 *   error    → nothing. A failed recommendation is never the shopper's
 *              problem, and the page around it must keep working (§31).
 *   empty    → nothing. Never "0 recommendations" (§30).
 *
 * Knows nothing about providers, placements' strategies or signals.
 */
import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProductCard, ProductCardSkeleton } from '@/components/storefront/product/product-card';
import type { Product } from '@/lib/storefront/types';
import { cn } from '@/lib/utils';

export interface RecommendationSectionItem {
  product: Product;
  /** shown under the card only when `showReasons` is set */
  reason?: string;
}

const SKELETON_COUNT = 4;

export function RecommendationSection({
  id,
  title,
  subtitle,
  items,
  loading = false,
  error = false,
  href,
  linkLabel = 'See all',
  showReasons = false,
  onProductClick,
  variant = 'rail',
  className,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  items: RecommendationSectionItem[];
  loading?: boolean;
  error?: boolean;
  href?: string;
  linkLabel?: string;
  showReasons?: boolean;
  /** fired when a card's link is followed (not its buttons) */
  onProductClick?: (product: Product, rank: number) => void;
  /** `rail`: nested in a padded page (PDP, catalogue, bag). `band`: a
   *  homepage band with its own container and section rhythm. */
  variant?: 'rail' | 'band';
  className?: string;
}) {
  const showSkeleton = loading && items.length === 0;
  if (!showSkeleton && (error || items.length === 0)) return null;

  const headingId = id ? `${id}-heading` : undefined;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-busy={showSkeleton || undefined}
      className={cn(
        'scroll-mt-24',
        variant === 'band' ? 'sf-container sf-section' : 'mt-10 border-t pt-8',
        className,
      )}
    >
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {href && items.length > 0 && (
          <Link
            href={href}
            className="group hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-teal underline-offset-4 hover:underline sm:inline-flex"
          >
            {linkLabel}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      {/* Bleeds to the screen edge on a phone so the cut-off last card cues
        * the scroll — the same rail mechanics as HighlightRail. */}
      <ul className="sf-no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {showSkeleton
          ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <li key={i} className="w-[45vw] shrink-0 sm:w-52 lg:w-56" aria-hidden>
                <ProductCardSkeleton />
              </li>
            ))
          : items.map(({ product, reason }, index) => (
              <li
                key={product.id}
                className="flex w-[45vw] shrink-0 snap-start flex-col sm:w-52 lg:w-56"
                onClickCapture={(event) => {
                  // Only a followed link counts — not add-to-bag or wishlist.
                  const target = event.target;
                  if (target instanceof Element && target.closest('a[href]')) {
                    onProductClick?.(product, index + 1);
                  }
                }}
              >
                <ProductCard product={product} />
                {showReasons && reason && (
                  <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{reason}</p>
                )}
              </li>
            ))}
      </ul>
    </section>
  );
}
