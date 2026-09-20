/*
 * "Goes with" and "bought together" — the two complement signals, and the
 * rules that keep them honest:
 *
 *   • a pairing only counts from 2+ real shared baskets;
 *   • a merchant's companion list is cleaned against the store's own
 *     categories (no self-pairing, no hidden/deleted/foreign ids);
 *   • co-purchases outrank category pairings in the bag, carry their own
 *     reason, and a foreign id among them never reaches the shopper;
 *   • with no sales (the fixtures), nothing is labelled "bought together".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { rankBoughtTogether, MIN_SHARED_BASKETS } from '@/lib/storefront/data/bought-together';
import { buildCatalogue } from '@/lib/storefront/data/catalogue';
import { CATEGORIES } from '@/lib/storefront/mock/categories';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import { getRecommendations } from '@/lib/storefront/product-detail';
import { createRecommendationCatalogue } from './catalogue';
import { recommendProducts, setRecommendationCatalogueFactory } from './service';
import type { RecommendationCatalogue } from './types';
import type { StoreScope } from '@/lib/storefront/types';

const store = { organizationSlug: 'demo' };

afterEach(() => setRecommendationCatalogueFactory(null));

describe('rankBoughtTogether', () => {
  const baskets = (...ids: string[]) => new Set(ids);

  it(`needs ${MIN_SHARED_BASKETS}+ shared baskets — one order is an anecdote, and would expose that shopper`, () => {
    const ranked = rankBoughtTogether(
      new Map([
        ['once', baskets('o:1')],
        ['twice', baskets('o:1', 'i:7')],
        ['often', baskets('o:1', 'o:2', 'o:3')],
      ]),
    );
    expect(ranked).toEqual([
      { productId: 'often', baskets: 3 },
      { productId: 'twice', baskets: 2 },
    ]);
  });
});

describe('merchant companion rules', () => {
  const [a, b, c] = CATEGORIES;

  it('keeps only categories the store has, never the category itself, without repeats', () => {
    const catalogue = buildCatalogue({
      organizationSlug: 'x',
      storeName: 'X',
      currency: 'NGN',
      products: [],
      categories: [a, b, c],
      brands: [],
      collections: [],
      companions: new Map([
        [a.id, { title: '  Complete the look ', categoryIds: [a.id, b.id, 'cat_from_another_store', b.id, c.id] }],
        [b.id, { title: null, categoryIds: [b.id] }],
        ['cat_deleted', { title: null, categoryIds: [a.id] }],
      ]),
    });

    expect(catalogue.companionsFor(a.id)).toEqual({ title: 'Complete the look', categoryIds: [b.id, c.id] });
    // Only itself → no rule at all, so the page falls back to sibling aisles.
    expect(catalogue.companionsFor(b.id)).toBeNull();
    expect(catalogue.companionsFor('cat_deleted')).toBeNull();
  });
});

describe('bought together in the bag', () => {
  const laptop = PRODUCTS.find((p) => p.categoryId === 'cat_laptops')!;
  const partner = PRODUCTS.find((p) => p.categoryId === 'cat_duvets' && p.inStock)!;

  /** The real (fixture) catalogue, plus sales history the fixtures lack. */
  const withSales = (store: StoreScope): RecommendationCatalogue => ({
    ...createRecommendationCatalogue(store),
    boughtTogether: async (productId) =>
      productId === laptop.id
        ? [
            { productId: partner.id, baskets: 4 },
            // A product of another store — it must not resolve.
            { productId: 'prod_from_another_store', baskets: 9 },
          ]
        : [],
  });

  it('puts real co-purchases first, with their own reason', async () => {
    setRecommendationCatalogueFactory(withSales);
    const response = await recommendProducts({ store, placement: 'cart', context: { signals: { cartIds: [laptop.id] } } });

    expect(response.items[0].product.id).toBe(partner.id);
    expect(response.items[0].reason.kind).toBe('bought-together');
    // The merchant's pairings still fill the rest, labelled as pairings.
    expect(response.items.slice(1).every((i) => i.reason.kind === 'complements-cart')).toBe(true);
    expect(response.items.map((i) => i.product.id)).not.toContain('prod_from_another_store');
  });

  it('never claims "bought together" without sales', async () => {
    const response = await recommendProducts({ store, placement: 'cart', context: { signals: { cartIds: [laptop.id] } } });
    expect(response.items.length).toBeGreaterThan(0);
    expect(response.items.some((i) => i.reason.kind === 'bought-together')).toBe(false);
  });
});

describe('the product page', () => {
  it('shows no "Often bought together" rail for a store with no sales, but still completes the look', async () => {
    const laptop = PRODUCTS.find((p) => p.categoryId === 'cat_laptops')!;
    const recs = await getRecommendations(laptop, store);
    expect(recs.boughtTogether).toEqual([]);
    expect(recs.completeTheLook.length).toBeGreaterThan(0);
    // Companion categories are addressed by their real path, so a nested
    // aisle (Electronics › Computers › Keyboards & mice) is found.
    expect(recs.completeTheLook.every((p) => p.categoryId !== laptop.categoryId)).toBe(true);
  });
});
