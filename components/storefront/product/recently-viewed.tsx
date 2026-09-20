'use client';

/*
 * "Recently viewed".
 *
 * The ids live in the browser (lib/storefront/stores/recently-viewed-store.ts,
 * persisted per tenant), so this rail cannot be server-rendered with the
 * page — it resolves them after hydration through
 * /api/storefront/products, which reads the same catalogue everything else
 * does. No account, no server-side view history, one request for the lot.
 *
 * Renders nothing until it has real products, so a first-time visitor never
 * sees an empty heading.
 */
import * as React from 'react';
import { HighlightRail } from '@/components/storefront/catalog/highlight-rail';
import { useRecentlyViewedStore } from '@/lib/storefront/stores/recently-viewed-store';
import { useStorefront } from '@/lib/storefront/context';
import type { Product } from '@/lib/storefront/types';

export function RecentlyViewed({
  excludeProductId,
  title = 'Recently viewed',
  className,
}: {
  excludeProductId?: string;
  title?: string;
  className?: string;
}) {
  const { org } = useStorefront();
  const ids = useRecentlyViewedStore((s) => s.ids);
  const [products, setProducts] = React.useState<Product[]>([]);

  // The product being looked at is not something to recommend looking at.
  const wanted = React.useMemo(
    () => ids.filter((id) => id !== excludeProductId).slice(0, 12),
    [ids, excludeProductId],
  );
  const key = wanted.join(',');

  React.useEffect(() => {
    if (!key) {
      setProducts([]);
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/storefront/products?ids=${encodeURIComponent(key)}&store=${encodeURIComponent(org.slug)}`,
      { signal: controller.signal },
    )
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((data: { products: Product[] }) => setProducts(data.products ?? []))
      .catch(() => {
        /* aborted or offline — the rail simply doesn't appear */
      });
    return () => controller.abort();
  }, [key, org.slug]);

  if (!products.length) return null;

  const rail = <HighlightRail title={title} products={products} />;
  return className ? <div className={className}>{rail}</div> : rail;
}
