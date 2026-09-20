/*
 * Phase 11 — the Recommendation Service and its mock provider, driven the
 * way the pages drive them: a store, a placement, a context, signals.
 *
 * What these pin down is the contract a real engine will inherit — grounded
 * products, deterministic output, honest reasons, exclusions that hold, a
 * cold start that is never empty, and a page that survives a provider
 * falling over.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeRequest,
  recommendProducts,
  setRecommendationCatalogueFactory,
  setRecommendationProvider,
} from './service';
import { createRulesRecommendationProvider } from './rules-provider';
import { createRecommendationCatalogue } from './catalogue';
import { recommendationHeading } from './copy';
import { COMPANIONS } from '@/lib/storefront/mock/companions';
import { CATEGORY_BY_ID } from '@/lib/storefront/mock/categories';
import { PRODUCTS, PRODUCT_BY_ID } from '@/lib/storefront/mock/products';
import type {
  RecommendationProvider,
  RecommendationRequest,
  RecommendationResponse,
} from './types';

const store = { organizationSlug: 'demo' };
const ids = (response: RecommendationResponse) => response.items.map((i) => i.product.id);

const inCategory = (categoryId: string) => PRODUCTS.filter((p) => p.categoryId === categoryId);
const sneakers = inCategory('cat_sneakers');
const laptop = inCategory('cat_laptops')[0];

afterEach(() => {
  setRecommendationProvider(null);
  setRecommendationCatalogueFactory(null);
  vi.restoreAllMocks();
});

/* ─────────────────────────────── provider ────────────────────────────── */

describe('rules provider', () => {
  const provider = createRulesRecommendationProvider();
  const run = (request: RecommendationRequest) =>
    provider.recommend(normalizeRequest(request), createRecommendationCatalogue(store));

  it('is deterministic: the same store, placement and context give the same ranking', async () => {
    const request: RecommendationRequest = {
      store,
      placement: 'homepage',
      context: { signals: { recentlyViewedIds: sneakers.map((p) => p.id).slice(0, 2), recentQueries: ['bag'] } },
    };
    const first = await run(request);
    const second = await run(request);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('only ever returns ids that exist in the catalogue, ranked by score', async () => {
    for (const placement of ['homepage', 'product', 'cart', 'search', 'category'] as const) {
      const ranked = await run({
        store,
        placement,
        context: {
          productId: sneakers[0].id,
          query: 'dress',
          categoryPath: ['fashion'],
          signals: { cartIds: [laptop.id], recentlyViewedIds: [sneakers[1].id] },
        },
      });
      for (const entry of ranked) expect(PRODUCT_BY_ID.has(entry.productId)).toBe(true);
      const scores = ranked.map((r) => r.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it('returns nothing for a cold homepage — cold start belongs to the service', async () => {
    expect(await run({ store, placement: 'homepage', context: {} })).toEqual([]);
  });

  it('treats a forged product id as no context rather than failing', async () => {
    const ranked = await run({ store, placement: 'product', context: { productId: 'prod_does_not_exist' } });
    expect(ranked).toEqual([]);
  });
});

/* ───────────────────────────── contexts ──────────────────────────────── */

describe('placements', () => {
  it('homepage (warm): prioritises the categories the shopper browsed, with an honest reason', async () => {
    const response = await recommendProducts({
      store,
      placement: 'homepage',
      context: { signals: { recentlyViewedIds: [sneakers[0].id, sneakers[1].id] } },
    });

    expect(response.strategy).toBe('personalized');
    const personal = response.items.filter((i) => i.strategy === 'personalized');
    expect(personal.length).toBeGreaterThan(0);
    // Footwear (sneakers' parent aisle) leads.
    const shoes = CATEGORY_BY_ID.get('cat_shoes');
    expect(shoes).toBeDefined();
    expect(response.items[0].product.categoryIds).toContain('cat_shoes');
    expect(personal.every((i) => i.reason.kind === 'viewed-similar')).toBe(true);
    // Viewed products have their own rail on the homepage.
    expect(ids(response)).not.toContain(sneakers[0].id);
    expect(ids(response)).not.toContain(sneakers[1].id);
  });

  it('homepage (wishlist): mixes in companions of saved items without touching the wishlist', async () => {
    const saved = sneakers[0];
    const signals = { wishlistIds: [saved.id] };
    const response = await recommendProducts({ store, placement: 'homepage', context: { signals } });

    const complements = response.items.filter((i) => i.reason.kind === 'wishlist-complement');
    expect(complements.length).toBeGreaterThan(0);
    for (const item of complements) {
      const slug = CATEGORY_BY_ID.get(item.product.categoryId)?.slug;
      expect(COMPANIONS.sneakers.categories).toContain(slug);
    }
    expect(response.items.some((i) => i.reason.kind === 'wishlist-similar')).toBe(true);
    expect(ids(response)).not.toContain(saved.id);
    expect(signals).toEqual({ wishlistIds: [saved.id] });
  });

  it('product: similar products from the same part of the store, never the product itself', async () => {
    const product = sneakers[0];
    const response = await recommendProducts({ store, placement: 'product', context: { productId: product.id } });

    expect(response.total).toBeGreaterThan(0);
    expect(ids(response)).not.toContain(product.id);
    expect(response.items[0].product.categoryId).toBe(product.categoryId);
    expect(response.items.every((i) => i.reason.kind === 'similar-to-product')).toBe(true);
  });

  it('cart: complements rather than duplicates, from the companion categories', async () => {
    const response = await recommendProducts({
      store,
      placement: 'cart',
      context: { signals: { cartIds: [laptop.id] } },
    });

    const companions = COMPANIONS.laptops.categories;
    expect(response.strategy).toBe('contextual');
    expect(response.total).toBeGreaterThan(0);
    expect(ids(response)).not.toContain(laptop.id);
    for (const item of response.items) {
      expect(item.product.categoryId).not.toBe(laptop.categoryId);
      const leafSlug = CATEGORY_BY_ID.get(item.product.categoryId)?.slug;
      expect(companions).toContain(leafSlug);
      expect(item.reason.kind).toBe('complements-cart');
    }
  });

  it('cart: a category that complements several bag items ranks first', async () => {
    // Both a laptop and a monitor list keyboards-mice as a companion.
    const monitor = inCategory('cat_monitors')[0];
    const response = await recommendProducts({
      store,
      placement: 'cart',
      context: { signals: { cartIds: [laptop.id, monitor.id] } },
    });
    expect(response.items[0].product.categoryId).toBe('cat_keyboards-mice');
  });

  it('search: stays in the departments the query led to and excludes results on screen', async () => {
    const onScreen = [sneakers[0].id];
    const response = await recommendProducts({
      store,
      placement: 'search',
      context: { query: 'sneakers' },
      exclude: onScreen,
    });

    expect(response.total).toBeGreaterThan(0);
    expect(ids(response)).not.toContain(sneakers[0].id);
    expect(response.items.every((i) => i.product.categoryIds.includes('cat_shoes'))).toBe(true);
    expect(response.items.every((i) => i.reason.kind === 'related-to-search')).toBe(true);
  });

  it('category: popular products from inside the category, best sellers first', async () => {
    const response = await recommendProducts({
      store,
      placement: 'category',
      context: { categoryPath: ['home-living'] },
      limit: 6,
    });

    expect(response.total).toBeGreaterThan(0);
    expect(response.items.every((i) => i.product.categoryIds.includes('cat_home-living'))).toBe(true);
    expect(response.items[0].reason.label).toMatch(/^Popular in /);
  });
});

/* ──────────────────────────── exclusions ─────────────────────────────── */

describe('exclusions', () => {
  it('never shows an excluded product, a bag item, the current product, or anything out of stock', async () => {
    const product = sneakers[0];
    const excluded = PRODUCTS.slice(0, 20).map((p) => p.id);
    const cart = [sneakers[1].id];

    for (const placement of ['homepage', 'product', 'cart', 'search', 'category'] as const) {
      const response = await recommendProducts({
        store,
        placement,
        context: { productId: product.id, query: 'shoe', categoryPath: ['fashion'], signals: { cartIds: cart } },
        exclude: excluded,
      });
      for (const item of response.items) {
        expect(excluded).not.toContain(item.product.id);
        expect(cart).not.toContain(item.product.id);
        expect(item.product.id).not.toBe(product.id);
        expect(item.product.inStock).toBe(true);
      }
      expect(new Set(ids(response)).size).toBe(response.total);
    }
  });

  it('holds even when a provider ignores the exclusions', async () => {
    const rogue: RecommendationProvider = {
      name: 'rogue',
      recommend: async () =>
        PRODUCTS.slice(0, 10).map((p, i) => ({
          productId: p.id,
          score: 100 - i,
          reason: { kind: 'popular', label: 'Popular in this store' },
          strategy: 'popular',
        })),
    };
    setRecommendationProvider(rogue);
    const excluded = PRODUCTS.slice(0, 5).map((p) => p.id);

    const response = await recommendProducts({ store, placement: 'category', context: {}, exclude: excluded });
    expect(ids(response).some((id) => excluded.includes(id))).toBe(false);
  });
});

/* ─────────────────────────────── service ─────────────────────────────── */

describe('service', () => {
  it('invokes the configured provider with a normalised, scoped request and catalogue', async () => {
    const recommend = vi.fn<RecommendationProvider['recommend']>(async () => []);
    setRecommendationProvider({ name: 'spy', recommend });

    await recommendProducts({
      store,
      placement: 'product',
      limit: 999,
      context: {
        productId: sneakers[0].id,
        signals: {
          recentlyViewedIds: ['prod_a', 'prod_a', 'not an id!', ...Array.from({ length: 30 }, (_, i) => `prod_${i}`)],
          recentQueries: ['  running  ', '', 'running'],
        },
      },
    });

    expect(recommend).toHaveBeenCalledOnce();
    const [request, catalogue] = recommend.mock.calls[0];
    expect(request.limit).toBe(16);
    expect(request.placement).toBe('product');
    expect(request.context.productId).toBe(sneakers[0].id);
    expect(request.context.signals.recentlyViewedIds[0]).toBe('prod_a');
    expect(request.context.signals.recentlyViewedIds).not.toContain('not an id!');
    expect(request.context.signals.recentlyViewedIds.length).toBe(12);
    expect(request.context.signals.recentQueries).toEqual(['running']);
    expect(request.context.signals.wishlistIds).toEqual([]);
    expect(catalogue.store).toEqual(store);
  });

  it('refuses a request without a store', async () => {
    await expect(
      recommendProducts({ store: { organizationSlug: '' }, placement: 'homepage', context: {} }),
    ).rejects.toThrow(/store scope/);
  });

  it('cold start: a new customer still gets a full homepage block', async () => {
    const response = await recommendProducts({ store, placement: 'homepage', context: {} });
    expect(response.total).toBe(8);
    expect(response.strategy).not.toBe('personalized');
    expect(response.items.every((i) => ['popular', 'new-arrivals', 'curated'].includes(i.strategy))).toBe(true);
    expect(response.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('cold start: follows trending → popular → new → curated, with reasons that match', async () => {
    const response = await recommendProducts({ store, placement: 'homepage', context: {}, limit: 16 });
    const order = ['trending', 'popular', 'new-arrival', 'featured'];
    const kinds = response.items.map((i) => order.indexOf(i.reason.kind));
    expect(kinds.every((k) => k >= 0)).toBe(true);
    expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
    for (const item of response.items.filter((i) => i.reason.kind === 'trending')) {
      expect(item.product.tags).toContain('trending');
    }
  });

  it('cold start: the homepage is not empty even when the page excludes a lot', async () => {
    const response = await recommendProducts({
      store,
      placement: 'homepage',
      context: {},
      exclude: PRODUCTS.slice(0, 40).map((p) => p.id),
    });
    expect(response.total).toBeGreaterThan(0);
  });

  it('pads a warm homepage from the ladder but not a contextual block that has results', async () => {
    const warm = await recommendProducts({
      store,
      placement: 'homepage',
      context: { signals: { recentlyViewedIds: [sneakers[0].id] } },
      limit: 16,
    });
    expect(warm.total).toBe(16);

    const search = await recommendProducts({ store, placement: 'search', context: { query: 'sneakers' }, limit: 16 });
    expect(search.items.every((i) => i.strategy === 'contextual')).toBe(true);
  });

  it('rescues a contextual placement the provider returned nothing for', async () => {
    setRecommendationProvider({ name: 'empty', recommend: async () => [] });
    const response = await recommendProducts({ store, placement: 'cart', context: {} });
    expect(response.total).toBeGreaterThan(0);
    expect(response.strategy).toBe('popular');
    expect(recommendationHeading('cart', response.strategy).title).not.toBe('Complete your order');
  });

  it('degrades to fallbacks when the provider throws, instead of breaking the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setRecommendationProvider({
      name: 'broken',
      recommend: async () => {
        throw new Error('model timeout');
      },
    });
    const response = await recommendProducts({ store, placement: 'product', context: { productId: laptop.id } });
    expect(response.degraded).toBe(true);
    expect(response.total).toBeGreaterThan(0);
    expect(ids(response)).not.toContain(laptop.id);
  });

  it('returns an empty response when even the catalogue fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = createRecommendationCatalogue(store);
    setRecommendationCatalogueFactory(() => ({
      ...real,
      productsByIds: async () => {
        throw new Error('db down');
      },
      bestsellers: async () => {
        throw new Error('db down');
      },
    }));
    const response = await recommendProducts({ store, placement: 'homepage', context: {} });
    expect(response).toMatchObject({ items: [], total: 0, strategy: null, degraded: true });
  });

  it('drops ids the provider invents', async () => {
    setRecommendationProvider({
      name: 'hallucinating',
      recommend: async () => [
        { productId: 'prod_made_up', score: 999, reason: { kind: 'popular', label: 'Popular in this store' }, strategy: 'popular' },
        { productId: sneakers[0].id, score: 1, reason: { kind: 'popular', label: 'Popular in this store' }, strategy: 'popular' },
      ],
    });
    const response = await recommendProducts({ store, placement: 'category', context: {} });
    expect(ids(response)).toEqual([sneakers[0].id]);
    // The product is the catalogue's row, not anything the provider supplied.
    expect(response.items[0].product).toEqual(PRODUCT_BY_ID.get(sneakers[0].id));
  });
});

describe('headings', () => {
  it('never claims personalisation for a cold-start block', () => {
    expect(recommendationHeading('homepage', 'popular').subtitle).not.toMatch(/brows/i);
    expect(recommendationHeading('homepage', 'personalized').title).toBe('Recommended for you');
  });

  it('never claims purchase history anywhere', () => {
    for (const placement of ['homepage', 'product', 'cart', 'search', 'category'] as const) {
      for (const strategy of ['personalized', 'contextual', 'popular', 'new-arrivals', 'curated', null] as const) {
        const { title, subtitle } = recommendationHeading(placement, strategy, { categoryName: 'Shoes' });
        expect(`${title} ${subtitle ?? ''}`).not.toMatch(/bought|purchased/i);
      }
    }
  });
});
