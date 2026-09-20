'use client';

/*
 * Check the bag against the catalogue when the cart page opens.
 *
 * The bag is a snapshot taken whenever the shopper added something — which
 * may have been three weeks and one price change ago. This resolves every
 * line's product through the SAME endpoint the recently-viewed rail uses,
 * hands them to `reconcileCart` (lib/storefront/cart.ts) and returns the
 * list of things that had to change, which the page shows as a notice.
 *
 * It runs on the cart page only, not on every render of every rail: it is a
 * network call, and the bag is only consequential where it's being read.
 *
 * This is deliberately shaped like the server check that will replace it.
 * Today the endpoint reads fixtures and the answer is advisory; tomorrow
 * checkout asks the backend and the answer is binding. Nothing above this
 * hook — no page, no drawer, no badge — has to know which of those it is.
 */
import * as React from 'react';
import type { Product } from './types';
import type { CartNotice } from './cart';
import { useStorefront } from './context';
import { useCartStore } from './stores/cart-store';

export function useCartReconciliation(): { notices: CartNotice[]; checking: boolean } {
  const { org } = useStorefront();
  const reconcile = useCartStore((s) => s.reconcile);
  const hydrated = useCartStore((s) => s.hydrated);

  const [notices, setNotices] = React.useState<CartNotice[]>([]);
  const [checking, setChecking] = React.useState(false);

  // The ids present when the page opened. Deliberately NOT re-run as the
  // shopper edits quantities — re-checking on every tap would fight the
  // person doing the tapping.
  const ran = React.useRef(false);

  React.useEffect(() => {
    if (!hydrated || ran.current) return;
    const ids = [...new Set(useCartStore.getState().items.map((i) => i.productId))];
    ran.current = true;
    if (!ids.length) return;

    const controller = new AbortController();
    setChecking(true);
    fetch(
      `/api/storefront/products?ids=${encodeURIComponent(ids.join(','))}&store=${encodeURIComponent(org.slug)}`,
      { signal: controller.signal },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('lookup failed'))))
      .then((data: { products?: Product[] }) => {
        const products = data.products ?? [];
        // `authoritative` only when the lookup actually answered for every
        // id: a partial response means the catalogue is unreachable, not
        // that the shopper's products were deleted.
        const complete = ids.every((id) => products.some((p) => p.id === id));
        setNotices(reconcile(products, complete));
      })
      .catch(() => {
        /* offline or aborted — the bag renders from its snapshot, and
         * checkout will be the one to insist. */
      })
      .finally(() => setChecking(false));

    return () => controller.abort();
  }, [hydrated, org.slug, reconcile]);

  return { notices, checking };
}
