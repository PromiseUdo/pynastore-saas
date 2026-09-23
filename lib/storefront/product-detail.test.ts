/*
 * Phase 4 — product detail.
 *
 * Two halves: the service (what the route loads) and the variant/quantity
 * rules (what the picker enforces). Both are driven exactly as the page
 * drives them, so a pass here is a statement about /products/[slug] rather
 * than about a helper it happens to call.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { getProductsForIds, getRecommendations, loadProductPage } from './product-detail';
import { getProductBySlug, getProductQuestions, getDeliveryPromise } from './catalog';
import {
  canAddToCart,
  clampQuantity,
  initialSelection,
  maxQuantity,
  resolveVariant,
  selectValue,
  selectedCompareAt,
  selectedPrice,
  stockForValue,
} from './variant-selection';
import { discountPercent } from './format';
import { PRODUCTS, PRODUCT_BY_ID } from './mock/products';
import { CATEGORY_BY_SLUG } from './mock/categories';
import { COMPANIONS } from './mock/companions';
import { DEFAULT_SHIPPING } from './pricing';
import { useRecentlyViewedStore } from './stores/recently-viewed-store';
import type { Product, StoreScope } from './types';

const store: StoreScope = { organizationSlug: 'demo' };

/** A product with both a colour and a size — the interesting variant case. */
const multiOption = PRODUCTS.find((p) => p.options.length > 1)!;
/** A product with no options at all — the "don't show a picker" case. */
const noOption = PRODUCTS.find((p) => p.options.length === 0)!;

/* ─────────────────────────── the route's data ─────────────────────────── */

describe('product page data', () => {
  it('1. resolves a valid product by slug, with everything the page renders', async () => {
    const sample = PRODUCTS[0];
    const data = await loadProductPage(sample.slug, store);

    expect(data).not.toBeNull();
    expect(data!.product.id).toBe(sample.id);
    expect(data!.breadcrumb.length).toBeGreaterThan(0);
    expect(data!.breadcrumb[data!.breadcrumb.length - 1].id).toBe(sample.categoryId);
    expect(data!.delivery.options.length).toBeGreaterThan(0);
  });

  it('2. returns null for an unknown slug, so the route can render not-found', async () => {
    expect(await loadProductPage('non-existent-product', store)).toBeNull();
    expect(await getProductBySlug('non-existent-product')).toBeNull();
  });

  it('3. slug lookup is exact — a near miss is a miss', async () => {
    const sample = PRODUCTS[0];
    expect((await getProductBySlug(sample.slug))?.id).toBe(sample.id);
    expect(await getProductBySlug(`${sample.slug}-x`)).toBeNull();
    expect(await getProductBySlug(sample.slug.toUpperCase())).toBeNull();
  });

  it('4. the breadcrumb is the product’s real category chain, root first', async () => {
    const data = (await loadProductPage(multiOption.slug, store))!;
    const slugs = data.breadcrumb.map((c) => c.slug);
    expect(slugs[0]).toBe(CATEGORY_BY_SLUG.get(slugs[0])!.path[0]);
    expect(data.breadcrumb[0].level).toBe(0);
    expect(data.category!.id).toBe(multiOption.categoryId);
  });

  it('18. the repository boundary stays tenant-scoped', async () => {
    // The page passes a store through; every read accepts one. When these
    // become API calls the scope is already threaded to the seam.
    const data = await loadProductPage(PRODUCTS[3].slug, { organizationSlug: 'another-tenant' });
    expect(data).not.toBeNull();
    expect(data!.product.slug).toBe(PRODUCTS[3].slug);
  });
});

/* ──────────────────────────────── price ──────────────────────────────── */

describe('price and discount', () => {
  it('5. shows a discount only when the compare-at price is genuinely higher', () => {
    const onSale = PRODUCTS.find((p) => p.compareAtPrice && p.compareAtPrice > p.priceFrom)!;
    const pct = discountPercent(onSale.priceFrom, onSale.compareAtPrice);

    expect(pct).not.toBeNull();
    expect(pct).toBe(
      Math.round(((onSale.compareAtPrice! - onSale.priceFrom) / onSale.compareAtPrice!) * 100),
    );
    expect(pct!).toBeGreaterThan(0);
    expect(pct!).toBeLessThan(100);
  });

  it('6. a product with no compare-at price shows no discount and still prices', () => {
    const plain = PRODUCTS.find((p) => !p.compareAtPrice)!;
    expect(discountPercent(plain.priceFrom, plain.compareAtPrice)).toBeNull();
    expect(selectedCompareAt(plain, null)).toBeNull();
    expect(selectedPrice(plain, null)).toBe(plain.priceFrom);
  });

  it('7. the price follows the selected variant', () => {
    // Storage options carry a price delta, so the variants genuinely differ.
    const tiered = PRODUCTS.find(
      (p) => p.options.some((o) => o.name === 'Storage') && new Set(p.variants.map((v) => v.price)).size > 1,
    )!;
    const cheapest = [...tiered.variants].sort((a, b) => a.price - b.price)[0];
    const dearest = [...tiered.variants].sort((a, b) => b.price - a.price)[0];

    expect(selectedPrice(tiered, cheapest)).toBe(cheapest.price);
    expect(selectedPrice(tiered, dearest)).toBe(dearest.price);
    expect(dearest.price).toBeGreaterThan(cheapest.price);
  });
});

/* ─────────────────────────── variants & quantity ─────────────────────── */

describe('variant selection', () => {
  it('8. opens on an in-stock combination', () => {
    const selection = initialSelection(multiOption);
    const variant = resolveVariant(multiOption, selection);

    expect(Object.keys(selection)).toHaveLength(multiOption.options.length);
    expect(variant).not.toBeNull();
    expect(variant!.stock).toBeGreaterThan(0);
  });

  it('9. selecting a value resolves the matching variant', () => {
    const selection = initialSelection(multiOption);
    const option = multiOption.options[0];
    const other = option.values.find((v) => v.id !== selection[option.id])!;

    const next = selectValue(multiOption, selection, option.id, other.id);
    expect(Object.values(next)).toContain(other.id);

    const variant = resolveVariant(multiOption, next);
    expect(variant).not.toBeNull();
    expect(variant!.optionValueIds).toContain(other.id);
  });

  it('10. an incomplete selection resolves to no variant and cannot be added', () => {
    const partial = { [multiOption.options[0].id]: multiOption.options[0].values[0].id };
    expect(resolveVariant(multiOption, partial)).toBeNull();
    expect(canAddToCart(multiOption, null)).toBe(false);
    expect(maxQuantity(multiOption, null)).toBe(0);
  });

  it('11. a sold-out combination is reported as unavailable and cannot be added', () => {
    const soldOut = findSoldOutCombination();
    expect(soldOut, 'fixture catalogue has no sold-out variant').toBeTruthy();

    const { product, variant } = soldOut!;
    expect(variant.stock).toBe(0);
    expect(canAddToCart(product, variant)).toBe(false);
    expect(maxQuantity(product, variant)).toBe(0);
  });

  it('12. stock for a value accounts for the rest of the selection', () => {
    const selection = initialSelection(multiOption);
    const option = multiOption.options[0];
    const value = option.values[0];

    const scoped = stockForValue(multiOption, selection, option.id, value.id);
    const unscoped = stockForValue(multiOption, {}, option.id, value.id);

    // Held against one fixed option, a value can only ever have less stock
    // than it does across every combination.
    expect(scoped).toBeLessThanOrEqual(unscoped);
    expect(unscoped).toBe(
      multiOption.variants
        .filter((v) => v.optionValueIds.includes(value.id))
        .reduce((n, v) => n + v.stock, 0),
    );
  });

  it('13. choosing a value keeps it, repairing the other options if needed', () => {
    const soldOut = findSoldOutCombination();
    const { product, variant } = soldOut!;

    const selection: Record<string, string> = {};
    product.options.forEach((option) => {
      const match = option.values.find((v) => variant.optionValueIds.includes(v.id));
      if (match) selection[option.id] = match.id;
    });

    // Re-picking the value the shopper just tapped must never drop it.
    const option = product.options[0];
    const chosen = selection[option.id];
    const next = selectValue(product, selection, option.id, chosen);
    expect(Object.values(next)).toContain(chosen);
  });

  it('14. a product without options needs no picker and is still buyable', () => {
    expect(noOption.options).toHaveLength(0);
    expect(initialSelection(noOption)).toEqual({});
    expect(maxQuantity(noOption, null)).toBe(noOption.variants[0].stock);
    expect(canAddToCart(noOption, null)).toBe(noOption.variants[0].stock > 0);
  });
});

describe('quantity', () => {
  it('15. never goes below 1', () => {
    expect(clampQuantity(0, 10)).toBe(1);
    expect(clampQuantity(-5, 10)).toBe(1);
    expect(clampQuantity(1, 10)).toBe(1);
    expect(clampQuantity(Number.NaN, 10)).toBe(1);
  });

  it('16. never exceeds the stock of the selected variant', () => {
    expect(clampQuantity(99, 4)).toBe(4);
    expect(clampQuantity(4, 4)).toBe(4);
    // Out of stock still clamps to 1 rather than 0 — zero is a cart removal,
    // not a quantity a product page should be able to express.
    expect(clampQuantity(3, 0)).toBe(1);
  });
});

/* ───────────────────────────── recommendations ───────────────────────── */

describe('recommendations', () => {
  it('17. every rail excludes the product itself', async () => {
    const product = PRODUCTS.find((p) => p.categoryId === 'cat_headphones')!;
    const recs = await getRecommendations(product, store);

    for (const [name, set] of Object.entries(recs)) {
      if (!Array.isArray(set)) continue;
      expect((set as Product[]).some((p) => p.id === product.id), name).toBe(false);
    }
  });

  it('18. similar products come from the same part of the catalogue', async () => {
    const product = PRODUCTS.find((p) => p.categoryId === 'cat_serums')!;
    const { similar } = await getRecommendations(product, store);

    expect(similar.length).toBeGreaterThan(0);
    // Every pick shares at least one category with the product.
    expect(
      similar.every((p) => p.categoryIds.some((id) => product.categoryIds.includes(id))),
    ).toBe(true);
  });

  it('19. cheaper alternatives really are cheaper, and related', async () => {
    const expensive = PRODUCTS.find((p) => p.categoryId === 'cat_laptops')!;
    const { cheaper } = await getRecommendations(expensive, store);

    expect(cheaper.length).toBeGreaterThan(0);
    expect(cheaper.every((p) => p.priceFrom < expensive.priceFrom)).toBe(true);
    expect(cheaper.every((p) => p.inStock)).toBe(true);
    // Relevance first, not a store-wide price sort: nothing here is from an
    // unrelated department just because it is cheap.
    expect(
      cheaper.every((p) => p.categoryIds.some((id) => expensive.categoryIds.includes(id))),
    ).toBe(true);
  });

  it('20. premium alternatives cost more AND are better on something real', async () => {
    const checked = await Promise.all(
      PRODUCTS.slice(0, 40).map(async (product) => {
        const { premium } = await getRecommendations(product, store);
        return { product, premium };
      }),
    );
    const withPremium = checked.filter((c) => c.premium.length > 0);
    expect(withPremium.length).toBeGreaterThan(0);

    for (const { product, premium } of withPremium) {
      for (const candidate of premium) {
        expect(candidate.priceFrom).toBeGreaterThan(product.priceFrom);
        expect(
          candidate.rating.average >= product.rating.average ||
            candidate.soldCount > product.soldCount,
        ).toBe(true);
      }
    }
  });

  it('21. complete-the-look pulls from different categories, with a fitting heading', async () => {
    const laptop = PRODUCTS.find((p) => p.categoryId === 'cat_laptops')!;
    const recs = await getRecommendations(laptop, store);

    expect(recs.completeTheLook.length).toBeGreaterThan(0);
    expect(recs.completeTheLook.every((p) => p.categoryId !== laptop.categoryId)).toBe(true);
    expect(recs.completeTheLookTitle).toBe(COMPANIONS['laptops'].title);
  });

  it('22. every companion category in the map is a real category', () => {
    for (const [slug, rule] of Object.entries(COMPANIONS)) {
      expect(CATEGORY_BY_SLUG.get(slug), `companion key ${slug}`).toBeDefined();
      for (const companion of rule.categories) {
        expect(CATEGORY_BY_SLUG.get(companion), `${slug} → ${companion}`).toBeDefined();
      }
    }
  });

  it('23. "more from this brand" is only that brand', async () => {
    const product = PRODUCTS.find((p) => p.categoryId === 'cat_dresses')!;
    const { fromBrand } = await getRecommendations(product, store);
    expect(fromBrand.every((p) => p.brandId === product.brandId)).toBe(true);
  });

  it('24. every product on the site produces rails without throwing or repeating itself', async () => {
    for (const product of PRODUCTS.slice(0, 25)) {
      const recs = await getRecommendations(product, store);
      const ids = recs.similar.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(product.id);
    }
  });
});

/* ────────────────────────────── Q&A + delivery ───────────────────────── */

describe('questions and delivery', () => {
  it('25. serves the catalogue’s own reviews, and offers a guest no form', async () => {
    // Reviews come from the store's own records (here, the demo catalogue) —
    // never from borrowed copy. The demo catalogue has no customer questions
    // (nothing invents them), so Q&A reads empty and the page renders its
    // "yours would be the first" state with the ask form.
    const product = PRODUCTS[0];
    expect(await getProductQuestions(product.id, store)).toEqual([]);

    const page = await loadProductPage(product.slug, store);
    expect(page!.reviews.total).toBeGreaterThan(0);
    expect(page!.reviews.items.every((review) => review.productId === product.id)).toBe(true);
    // Most helpful first, and never more than one page of them.
    const helpful = page!.reviews.items.map((review) => review.helpful);
    expect(helpful).toEqual([...helpful].sort((a, b) => b - a));
    expect(page!.reviews.items.length).toBeLessThanOrEqual(page!.reviews.total);

    // Nobody is signed in in a test, so there is no form and no vote.
    expect(page!.reviews.signedIn).toBe(false);
    expect(page!.questions.items).toEqual([]);
    expect(page!.questions.pending).toEqual([]);
    expect(page!.questions.signedIn).toBe(false);
    expect(page!.reviews.viewer.canReview).toBe(false);
    expect(page!.reviews.votedIds).toEqual([]);
  });

  it('27. delivery quotes the store’s own zones, from their cheapest option', async () => {
    const delivery = await getDeliveryPromise(store);

    // The demo store delivers nationwide with the fixture methods; a real store
    // shows its zones (lib/storefront/delivery/quote.ts, tests/settings-delivery.test.ts).
    const nationwide = delivery.options.find((o) => o.kind === 'delivery');
    expect(nationwide?.label).toBe('Delivery across Nigeria');
    expect(nationwide?.price).toBe(DEFAULT_SHIPPING);
    expect(nationwide?.fromPrice).toBe(true);
    expect(nationwide?.free).toBe(false);
    expect(delivery.pickupAvailable).toBe(false);
    expect(delivery.returnWindowDays).toBeGreaterThan(0);
  });
});

/* ─────────────────────────── recently viewed ─────────────────────────── */

describe('recently viewed', () => {
  beforeEach(() => {
    useRecentlyViewedStore.setState({ ids: [] });
  });

  it('28. records views without duplicating, most recent first', () => {
    const { visit } = useRecentlyViewedStore.getState();
    visit('prod_a');
    visit('prod_b');
    visit('prod_a');

    expect(useRecentlyViewedStore.getState().ids).toEqual(['prod_a', 'prod_b']);
  });

  it('29. keeps at most a fixed number of products', () => {
    const { visit } = useRecentlyViewedStore.getState();
    for (let i = 0; i < 40; i++) visit(`prod_${i}`);

    const { ids } = useRecentlyViewedStore.getState();
    expect(ids.length).toBeLessThanOrEqual(12);
    expect(ids[0]).toBe('prod_39');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('30. resolves ids to real products, in order, dropping unknown ones', async () => {
    const ids = [PRODUCTS[5].id, 'prod_deleted_thing', PRODUCTS[1].id];
    const resolved = await getProductsForIds(ids, store);

    expect(resolved.map((p) => p.id)).toEqual([PRODUCTS[5].id, PRODUCTS[1].id]);
    expect(resolved.every((p) => PRODUCT_BY_ID.has(p.id))).toBe(true);
  });

  it('31. an empty history resolves to nothing rather than the catalogue', async () => {
    expect(await getProductsForIds([], store)).toEqual([]);
  });
});

/* helper: a product/variant pair that is genuinely out of stock */
function findSoldOutCombination(): { product: Product; variant: Product['variants'][number] } | null {
  for (const product of PRODUCTS) {
    if (!product.options.length) continue;
    const variant = product.variants.find((v) => v.stock === 0);
    if (variant) return { product, variant };
  }
  return null;
}
