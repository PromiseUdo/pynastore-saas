/*
 * The recommendation catalogue port.
 *
 *   provider  →  RecommendationCatalogue  →  lib/storefront/catalog.ts
 *                                          →  fixtures today, Prisma later
 *
 * Same idea as lib/storefront/visual-search/catalogue.ts, narrowed to what
 * ranking recommendations needs:
 *
 *  1. TENANT ISOLATION BY CONSTRUCTION (§26). Every method injects the
 *     StoreScope the port was built with. A provider never sees a store slug
 *     it could swap, so no call it makes can reach another merchant's rows —
 *     and a signal id from another store resolves to nothing.
 *  2. NO SECOND CATALOGUE (§25). Every read is `listProducts`, the Product
 *     Discovery engine behind /search, /c/* and collections. Availability,
 *     filtering and product data stay owned there.
 *
 * Server-only: it reads the catalogue.
 */
import {
  getCategoryById,
  getCategoryByPath,
  getCompanionCategories,
  getFrequentlyBoughtTogether,
  listProducts,
} from '@/lib/storefront/catalog';
import type { Category, StoreScope } from '@/lib/storefront/types';
import type { RecommendationCatalogue, RecommendationCategory } from './types';

/** Never ask the engine for an unbounded page. */
const MAX_READ = 200;

const clamp = (limit: number) => Math.min(Math.max(Math.floor(limit), 1), MAX_READ);

function toCategory(category: Category | null): RecommendationCategory | null {
  if (!category) return null;
  const { id, slug, name, path, parentId } = category;
  return { id, slug, name, path, parentId };
}

export function createRecommendationCatalogue(store: StoreScope): RecommendationCatalogue {
  return {
    store,

    async productsByIds(ids) {
      const unique = [...new Set(ids)].slice(0, MAX_READ);
      if (!unique.length) return [];
      /* Through the scoped list, never a direct by-id read: once this is
       * Prisma-backed an id belonging to another store comes back as nothing
       * rather than as that store's row. */
      const { items } = await listProducts({ store, productIds: unique, perPage: unique.length });
      const byId = new Map(items.map((p) => [p.id, p]));
      return unique.map((id) => byId.get(id)).filter((p) => p !== undefined);
    },

    async bestsellers({ categoryPath, limit }) {
      const { items } = await listProducts({
        store,
        categoryPath: categoryPath?.length ? categoryPath : undefined,
        sort: 'bestselling',
        perPage: clamp(limit),
      });
      return items;
    },

    async newest(limit) {
      const { items } = await listProducts({ store, sort: 'newest', perPage: clamp(limit) });
      return items;
    },

    async tagged(tag, limit) {
      const { items } = await listProducts({ store, tag, sort: 'bestselling', perPage: clamp(limit) });
      return items;
    },

    async search(query, limit) {
      if (!query.trim()) return [];
      const { items } = await listProducts({ store, query, sort: 'relevance', perPage: clamp(limit) });
      return items;
    },

    async categoryById(id) {
      return toCategory(await getCategoryById(id, store));
    },

    async categoryByPath(path) {
      return toCategory(await getCategoryByPath(path, store));
    },

    async companions(categoryId) {
      const rule = await getCompanionCategories(categoryId, store);
      return rule ? rule.categories.map((c) => toCategory(c)!) : null;
    },

    async boughtTogether(productId, limit) {
      const pairs = await getFrequentlyBoughtTogether(productId, clamp(limit), store);
      return pairs.map(({ product, baskets }) => ({ productId: product.id, baskets }));
    },
  };
}
