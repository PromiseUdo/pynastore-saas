/*
 * The visual-search catalogue port — the only door from visual search to
 * product rows.
 *
 *   ./service.ts  →  VisualSearchCatalogue  →  lib/storefront/catalog.ts
 *
 * The vector search (./vector-store.ts) returns product IDS with scores;
 * this turns them into the storefront's own Product rows through the store's
 * catalogue, which applies the storefront's visibility rules — published,
 * active, in a visible category, stocked by a store that sells online — so
 * visual search can never show a product the shop itself wouldn't. An id the
 * catalogue doesn't return (another store's, delisted, deleted) drops out.
 *
 * Built from a StoreScope resolved server-side; it never names a store of
 * its own. Server-only.
 */
import { listProducts } from '@/lib/storefront/catalog';
import { getStoreCurrency } from '@/lib/storefront/discovery';
import type { Product, StoreScope } from '@/lib/storefront/types';

export interface VisualSearchCatalogue {
  readonly store: StoreScope;
  /** rows for ids, in the order given; unknown/foreign/hidden ids drop out */
  productsByIds(ids: string[]): Promise<Product[]>;
  productById(id: string): Promise<Product | null>;
  currency(): Promise<string>;
}

export function createVisualSearchCatalogue(store: StoreScope): VisualSearchCatalogue {
  return {
    store,

    async productsByIds(ids) {
      const unique = [...new Set(ids)];
      if (!unique.length) return [];
      const { items } = await listProducts({ store, productIds: unique, perPage: unique.length });
      const byId = new Map(items.map((p) => [p.id, p]));
      return unique.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
    },

    async productById(id) {
      const { items } = await listProducts({ store, productIds: [id], perPage: 1 });
      return items[0] ?? null;
    },

    currency: () => getStoreCurrency(store),
  };
}
