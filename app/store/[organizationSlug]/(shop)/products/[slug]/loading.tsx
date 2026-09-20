/*
 * PDP skeleton — the same two-column geometry as the real page (gallery with
 * its thumbnail column, then identity/price/variants/actions), so nothing
 * moves when the content arrives.
 */
import { ProductGallerySkeleton } from '@/components/storefront/product/product-gallery';

export default function Loading() {
  return (
    <div className="sf-container py-4 lg:py-8">
      <div className="mb-3 h-3 w-56 animate-pulse rounded bg-muted sm:mb-5" />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <ProductGallerySkeleton />

        <div className="space-y-4">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-10 w-48 animate-pulse rounded bg-muted" />
          <div className="h-16 w-full animate-pulse rounded bg-muted" />
          <div className="space-y-2 border-t pt-6">
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="size-12 animate-pulse rounded-full bg-muted" />
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <div className="h-12 w-[8.5rem] shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="h-12 flex-1 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="h-40 w-full animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
