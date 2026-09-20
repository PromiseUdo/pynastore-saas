/*
 * The results grid and its skeleton.
 *
 * Kept in one file so the two can never drift: the skeleton renders the same
 * column counts and the same aspect ratio as the real grid, which is what
 * stops the layout jumping when data arrives. <ProductCard> already reserves
 * its image box with `aspect-square`, so there is no shift from imagery either.
 *
 * Server component — <ProductCard> is the only client boundary.
 */
import { ProductCard, ProductCardSkeleton } from '@/components/storefront/product/product-card';
import type { Product } from '@/lib/storefront/types';

/* 2 up on phones (a single column wastes half the screen for cards this
 * compact), 3 on tablets, 4 on desktop — matching the homepage grids. */
const GRID = 'grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-5 sm:gap-y-9 md:grid-cols-3 lg:grid-cols-4';

export function ResultsGrid({ products }: { products: Product[] }) {
  return (
    <div className={GRID}>
      {products.map((product, i) => (
        // Only the first row is priority — beyond the fold, eager loading
        // just competes with the rest of the page for bandwidth.
        <ProductCard key={product.id} product={product} priority={i < 4} />
      ))}
    </div>
  );
}

export function ResultsGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Full-page skeleton: toolbar + sidebar + grid, matching the real layout. */
export function CatalogSkeleton() {
  return (
    <div className="sf-container py-6 lg:py-10">
      <div className="h-3 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-4 h-8 w-3/4 max-w-72 animate-pulse rounded bg-muted" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <div className="hidden space-y-6 lg:block">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            </div>
          ))}
        </div>
        <div>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="h-11 flex-1 animate-pulse rounded-full bg-muted sm:w-28 sm:flex-none lg:hidden" />
              <div className="h-11 flex-1 animate-pulse rounded-full bg-muted sm:h-10 sm:w-40 sm:flex-none" />
            </div>
          </div>
          <ResultsGridSkeleton />
        </div>
      </div>
    </div>
  );
}
