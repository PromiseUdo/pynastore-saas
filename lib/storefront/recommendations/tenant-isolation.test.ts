/*
 * Tenant isolation for recommendations (§26).
 *
 * Two complementary proofs:
 *
 *  1. THE SEAM IS WIRED. The fixture catalogue is one global dataset, so —
 *     as in lib/ai/assistant and lib/storefront/visual-search — the real
 *     catalogue module is wrapped only to record the params each read
 *     receives. Every product read a recommendation causes must carry the
 *     request's store, so the day `listProducts` gains
 *     `where: { organizationId }` recommendations are scoped with no change.
 *
 *  2. THE BOUNDARY HOLDS. A two-tenant fake catalogue port (store A owns some
 *     products, store B the rest) proves the behaviour, not just the wiring:
 *     store B's products never reach store A's rails, store B's ids sent as
 *     store A "behaviour" contribute nothing, and a provider that tries to
 *     smuggle a foreign id through is overruled by the service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListProductsParams, Product, StoreScope } from '@/lib/storefront/types';
import type { RecommendationCatalogue, RecommendationProvider } from './types';

const seen: ListProductsParams[] = [];

vi.mock('@/lib/storefront/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storefront/catalog')>();
  return {
    ...actual,
    listProducts: (params: ListProductsParams = {}) => {
      seen.push(params);
      return actual.listProducts(params);
    },
  };
});

const { PRODUCTS } = await import('@/lib/storefront/mock/products');
const { createRecommendationCatalogue } = await import('./catalogue');
const { recommendProducts, setRecommendationCatalogueFactory, setRecommendationProvider } = await import(
  './service'
);

const PLACEMENTS = ['homepage', 'product', 'cart', 'search', 'category'] as const;

beforeEach(() => {
  seen.length = 0;
});

afterEach(() => {
  setRecommendationProvider(null);
  setRecommendationCatalogueFactory(null);
});

describe('the seam is wired', () => {
  it('carries the requesting store into every catalogue read, for every placement', async () => {
    for (const placement of PLACEMENTS) {
      seen.length = 0;
      await recommendProducts({
        store: { organizationSlug: `store-${placement}` },
        placement,
        context: {
          productId: PRODUCTS[0].id,
          query: 'sneakers',
          categoryPath: ['fashion'],
          signals: {
            recentlyViewedIds: [PRODUCTS[1].id],
            wishlistIds: [PRODUCTS[2].id],
            cartIds: [PRODUCTS[3].id],
            recentQueries: ['bag'],
            recentCategoryPaths: [['electronics']],
          },
        },
      });

      expect(seen.length, placement).toBeGreaterThan(0);
      for (const params of seen) {
        expect(params.store, placement).toEqual({ organizationSlug: `store-${placement}` });
      }
    }
  });

  it('never lets a catalogue port exist without a store', () => {
    const catalogue = createRecommendationCatalogue({ organizationSlug: 'store-x' });
    expect(catalogue.store).toEqual({ organizationSlug: 'store-x' });
  });
});

/* ───────────────────────────── two tenants ───────────────────────────── */

/** Even-indexed products belong to store A, odd-indexed to store B. */
const owner = new Map(PRODUCTS.map((p, i) => [p.id, i % 2 === 0 ? 'store-a' : 'store-b']));
const ownedBy = (slug: string) => PRODUCTS.filter((p) => owner.get(p.id) === slug);

/**
 * The real port, narrowed to one tenant's rows — exactly what a
 * Prisma-backed `listProducts` with `where: { organizationId }` will do.
 */
function tenantCatalogue(store: StoreScope): RecommendationCatalogue {
  const real = createRecommendationCatalogue(store);
  const mine = (products: Product[]) => products.filter((p) => owner.get(p.id) === store.organizationSlug);
  return {
    ...real,
    productsByIds: async (ids) => mine(await real.productsByIds(ids)),
    bestsellers: async (params) => mine(await real.bestsellers({ ...params, limit: 200 })).slice(0, params.limit),
    newest: async (limit) => mine(await real.newest(200)).slice(0, limit),
    tagged: async (tag, limit) => mine(await real.tagged(tag, 200)).slice(0, limit),
    search: async (query, limit) => mine(await real.search(query, 200)).slice(0, limit),
    boughtTogether: async (productId, limit) =>
      (await real.boughtTogether(productId, limit)).filter((p) => owner.get(p.productId) === store.organizationSlug),
  };
}

describe('the boundary holds', () => {
  beforeEach(() => setRecommendationCatalogueFactory(tenantCatalogue));

  it('never recommends another tenant’s product, in any placement', async () => {
    const storeA = { organizationSlug: 'store-a' };
    const aProduct = ownedBy('store-a')[0];

    for (const placement of PLACEMENTS) {
      const response = await recommendProducts({
        store: storeA,
        placement,
        context: {
          productId: aProduct.id,
          query: 'shoe',
          categoryPath: ['fashion'],
          signals: { cartIds: [aProduct.id] },
        },
        limit: 16,
      });
      for (const item of response.items) {
        expect(owner.get(item.product.id), `${placement}: ${item.product.id}`).toBe('store-a');
      }
    }
  });

  it('ignores another tenant’s behaviour: store B ids sent to store A change nothing', async () => {
    const storeA = { organizationSlug: 'store-a' };
    const foreign = ownedBy('store-b').slice(0, 10).map((p) => p.id);

    const cold = await recommendProducts({ store: storeA, placement: 'homepage', context: {} });
    const withForeignSignals = await recommendProducts({
      store: storeA,
      placement: 'homepage',
      context: { signals: { recentlyViewedIds: foreign, wishlistIds: foreign, cartIds: foreign } },
    });

    // Foreign ids resolved to nothing, so the session is still cold.
    expect(withForeignSignals.strategy).toBe(cold.strategy);
    expect(withForeignSignals.items.map((i) => i.product.id)).toEqual(cold.items.map((i) => i.product.id));
  });

  it('treats another tenant’s product page as no context at all', async () => {
    const foreignProduct = ownedBy('store-b')[0];
    const response = await recommendProducts({
      store: { organizationSlug: 'store-a' },
      placement: 'product',
      context: { productId: foreignProduct.id },
    });
    expect(response.items.every((i) => owner.get(i.product.id) === 'store-a')).toBe(true);
  });

  it('overrules a provider that returns a foreign id', async () => {
    const foreign = ownedBy('store-b')[0];
    const local = ownedBy('store-a').find((p) => p.inStock);
    if (!local) throw new Error('fixture: store A needs an in-stock product');

    const smuggler: RecommendationProvider = {
      name: 'smuggler',
      recommend: async () => [
        { productId: foreign.id, score: 1_000, reason: { kind: 'popular', label: 'Popular in this store' }, strategy: 'popular' },
        { productId: local.id, score: 1, reason: { kind: 'popular', label: 'Popular in this store' }, strategy: 'popular' },
      ],
    };
    setRecommendationProvider(smuggler);

    const response = await recommendProducts({
      store: { organizationSlug: 'store-a' },
      placement: 'category',
      context: {},
    });
    expect(response.items.map((i) => i.product.id)).toEqual([local.id]);
  });
});
