/*
 * Phase 3 — category & collection browsing.
 *
 * These drive the service exactly as the routes do: build criteria from a
 * URL, hand them to the discovery service, assert on what a page would
 * render. That is deliberate — it means a passing test here is a statement
 * about /c/…, /collections/… and /products, not about a helper the pages
 * happen to call.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  discoverProducts,
  getCategoryLanding,
  getCollectionLanding,
  resolveCollectionScope,
} from './product-discovery';
import {
  collectionQuery,
  getCategoryByPath,
  getCollectionBySlug,
  getCollectionSummaries,
  getCollections,
  listProducts,
  specValueId,
} from './catalog';
import { parseDiscoveryParams, toSearchParams, type DiscoveryCriteria } from './discovery-url';
import { COLLECTIONS } from './mock/collections';
import { PRODUCT_BY_ID } from './mock/products';
import { CATEGORY_BY_SLUG } from './mock/categories';
import type { OptionIndex, StoreScope } from './types';
import { getOptionIndex } from './catalog';

const store: StoreScope = { organizationSlug: 'demo' };
let index: OptionIndex;

/** Render a URL the way a route does: parse, then discover. */
const view = (url: string, defaults: Partial<DiscoveryCriteria> = {}) => {
  const { pathname, searchParams } = new URL(url, 'https://shop.demo.test');
  const raw = Object.fromEntries([...searchParams.keys()].map((k) => [k, searchParams.getAll(k)]));
  return discoverProducts({
    store,
    pathname,
    criteria: parseDiscoveryParams(raw, index, defaults),
  });
};

/** The category route's own pinning. */
const categoryView = async (slugPath: string[], search = '') => {
  const category = (await getCategoryByPath(slugPath))!;
  return view(`/c/${slugPath.join('/')}${search}`, { categoryPath: category.path });
};

/** The collection route's own pinning. */
const collectionView = async (slug: string, search = '') => {
  const resolved = await resolveCollectionScope(slug, store);
  if (!resolved) return null;
  return view(`/collections/${slug}${search}`, {
    scope: resolved.scope,
    sort: resolved.collection.sort,
  });
};

beforeAll(async () => {
  index = await getOptionIndex();
});

/* ─────────────────────────── all products ─────────────────────────── */

describe('/products — the whole catalogue', () => {
  it('1. lists every product, paged', async () => {
    const { result } = await view('/products');
    const { total } = await listProducts({ perPage: 1 });
    expect(result.total).toBe(total);
    expect(result.items.length).toBe(Math.min(result.perPage, total));
    expect(result.pageCount).toBeGreaterThan(1);
  });
});

/* ──────────────────────────── categories ───────────────────────────── */

describe('category pages', () => {
  it('2. a department returns only its own subtree', async () => {
    const { result } = await categoryView(['electronics']);
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((p) => p.categoryIds.includes('cat_electronics'))).toBe(true);
  });

  it('3. a subcategory narrows further and stays inside its parent', async () => {
    const parent = await categoryView(['electronics']);
    const child = await categoryView(['electronics', 'audio']);
    expect(child.result.total).toBeGreaterThan(0);
    expect(child.result.total).toBeLessThan(parent.result.total);
    expect(child.result.items.every((p) => p.categoryIds.includes('cat_audio'))).toBe(true);
  });

  it('4. a leaf returns only that leaf', async () => {
    const { result } = await categoryView(['electronics', 'audio', 'headphones']);
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((p) => p.categoryId === 'cat_headphones')).toBe(true);
  });

  it('19. no product from an unrelated department leaks in', async () => {
    const { result } = await categoryView(['beauty'], '?page=1');
    const all = await listProducts({ categoryPath: ['beauty'], perPage: 500 });
    expect(all.items.every((p) => p.categoryIds.includes('cat_beauty'))).toBe(true);
    expect(result.items.some((p) => p.categoryIds.includes('cat_electronics'))).toBe(false);
  });

  it('5. an unknown category path resolves to nothing, so the route can 404', async () => {
    expect(await getCategoryByPath(['not-a-category'])).toBeNull();
    // a real slug in the wrong place is also a miss, not a loose match
    expect(await getCategoryByPath(['electronics', 'dresses'])).toBeNull();
  });

  it('6. the landing exposes children with real, non-zero counts', async () => {
    const category = (await getCategoryByPath(['fashion']))!;
    const landing = await getCategoryLanding({ store, category });

    expect(landing.chain.map((c) => c.slug)).toEqual(['fashion']);
    expect(landing.children.length).toBeGreaterThan(0);
    expect(landing.children.every((c) => c.productCount > 0)).toBe(true);

    for (const child of landing.children) {
      const { total } = await listProducts({ categoryPath: child.path, perPage: 1 });
      expect(child.productCount).toBe(total);
    }
  });

  it('7. a leaf offers its siblings instead of an empty child rail', async () => {
    const category = (await getCategoryByPath(['fashion', 'women', 'skirts']))!;
    const landing = await getCategoryLanding({ store, category });

    expect(landing.children).toHaveLength(0);
    expect(landing.siblings.length).toBeGreaterThan(0);
    expect(landing.siblings.some((c) => c.slug === 'skirts')).toBe(false);
    expect(landing.siblings.every((c) => c.path[1] === 'women')).toBe(true);
  });

  it('8. the "popular in" rail is real products from this category, best-selling first', async () => {
    const category = (await getCategoryByPath(['home-living']))!;
    const { popular } = await getCategoryLanding({ store, category });

    expect(popular.length).toBeGreaterThan(0);
    expect(popular.every((p) => p.categoryIds.includes('cat_home-living'))).toBe(true);
    const sold = popular.map((p) => p.soldCount);
    expect(sold).toEqual([...sold].sort((a, b) => b - a));
  });
});

/* ────────────────────── category discovery (Phase 2 reuse) ────────────────────── */

describe('category filtering, sorting and search', () => {
  it('9. a filter narrows within the category and never outside it', async () => {
    const base = await categoryView(['fashion']);
    const filtered = await categoryView(['fashion'], '?stock=1&rating=4');

    expect(filtered.result.total).toBeGreaterThan(0);
    expect(filtered.result.total).toBeLessThan(base.result.total);
    expect(
      filtered.result.items.every(
        (p) => p.inStock && p.rating.average >= 4 && p.categoryIds.includes('cat_fashion'),
      ),
    ).toBe(true);
  });

  it('10. sorting applies inside the category', async () => {
    const { result } = await categoryView(['electronics'], '?sort=price-asc');
    const prices = result.items.map((p) => p.priceFrom);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(result.items.every((p) => p.categoryIds.includes('cat_electronics'))).toBe(true);
  });

  it('11. searching within a category searches only that category', async () => {
    const scoped = await categoryView(['beauty'], '?q=serum');
    expect(scoped.result.total).toBeGreaterThan(0);
    expect(scoped.result.items.every((p) => p.categoryIds.includes('cat_beauty'))).toBe(true);

    // the same term unscoped is free to match anything
    const everywhere = await view('/search?q=serum');
    expect(everywhere.result.total).toBeGreaterThanOrEqual(scoped.result.total);
  });

  it('12. a term with no match inside the category returns zero, not the whole store', async () => {
    const { result } = await categoryView(['grocery'], '?q=laptop');
    expect(result.total).toBe(0);
  });

  it('13. filter state round-trips through the URL', async () => {
    const filtered = await categoryView(['fashion'], '?colour=black&rating=4&stock=1&sort=price-asc');
    const qs = toSearchParams(filtered.criteria, index);

    expect(qs.get('colour')).toBe('black');
    expect(qs.get('rating')).toBe('4');
    expect(qs.get('stock')).toBe('1');
    expect(qs.get('sort')).toBe('price-asc');
    // the category is NOT in the query string — it belongs to the path
    expect(qs.get('categoryPath')).toBeNull();

    // reload: the same URL reproduces the same results, which is what makes
    // refresh, back/forward and a pasted link all behave
    const again = await categoryView(['fashion'], `?${qs.toString()}`);
    expect(again.result.items.map((p) => p.id)).toEqual(
      filtered.result.items.map((p) => p.id),
    );
    expect(again.result.total).toBe(filtered.result.total);
  });

  it('14. filters are category-specific, driven by what the products carry', async () => {
    const laptops = await categoryView(['electronics', 'computers', 'laptops']);
    const shirts = await categoryView(['fashion', 'men', 'shirts']);

    const names = (v: typeof laptops) => v.result.facets.options.map((o) => o.name);

    expect(names(laptops)).toContain('Storage');
    expect(names(laptops)).toContain('Connectivity');
    expect(names(laptops)).not.toContain('Fit');

    expect(names(shirts)).toContain('Size');
    expect(names(shirts)).toContain('Fit');
    expect(names(shirts)).not.toContain('Storage');
  });

  it('15. a spec filter from the URL actually narrows the pool', async () => {
    const base = await categoryView(['fashion', 'men', 'shirts']);
    const fit = base.result.facets.options.find((o) => o.name === 'Fit')!;
    const bucket = fit.buckets[0];
    const { label } = bucket;
    const key = index.find((e) => e.name === 'Fit')!.values.find((v) => v.id === bucket.value)!.key;

    const filtered = await categoryView(['fashion', 'men', 'shirts'], `?fit=${key}`);
    expect(filtered.result.total).toBeGreaterThan(0);
    expect(filtered.result.total).toBeLessThanOrEqual(base.result.total);
    expect(
      filtered.result.items.every((p) =>
        p.specs.some((s) => s.label === 'Fit' && s.value === label),
      ),
    ).toBe(true);
    expect(bucket.value).toBe(specValueId('Fit', label));
  });

  it('16. counts always match the filtered result, never a stored number', async () => {
    const filtered = await categoryView(['fashion'], '?stock=1');
    const recount = await listProducts({
      categoryPath: ['fashion'],
      inStockOnly: true,
      perPage: 1,
    });
    expect(filtered.result.total).toBe(recount.total);
  });

  it('17. over-narrowing gives an honest empty state with a way back', async () => {
    const { result, criteria, clearHref } = await categoryView(
      ['grocery'],
      '?minPrice=900000&rating=5',
    );
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
    // clearing returns to the category, not to the whole store
    expect(clearHref).toBe('/c/grocery');
    expect(criteria.categoryPath).toEqual(['grocery']);
  });
});

/* ──────────────────────────── collections ──────────────────────────── */

describe('collection data', () => {
  it('18. every curated id resolves to a real product', () => {
    for (const collection of COLLECTIONS) {
      if (collection.rule.kind !== 'curated') continue;
      const ids = collection.rule.productIds ?? [];
      expect(ids.length, `${collection.slug} is empty`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(PRODUCT_BY_ID.get(id), `${collection.slug} → ${id}`).toBeDefined();
      }
    }
  });

  it('19. collections hold references, never copies of products', () => {
    for (const collection of COLLECTIONS) {
      const serialised = JSON.stringify(collection);
      expect(serialised).not.toContain('"priceFrom"');
      expect(serialised).not.toContain('"variants"');
    }
  });

  it('20. every collection resolves to at least one product', async () => {
    for (const collection of await getCollections()) {
      const { total } = await listProducts({ ...collectionQuery(collection), perPage: 1 });
      expect(total, `${collection.slug}`).toBeGreaterThan(0);
    }
  });

  it('21. a curated collection can span departments', async () => {
    const travel = (await getCollectionBySlug('travel-essentials'))!;
    const { items } = await listProducts({ ...collectionQuery(travel), perPage: 100 });
    const roots = new Set(items.map((p) => p.categoryIds[0]));
    expect(roots.size).toBeGreaterThan(1);
  });

  it('22. a dynamic collection is a rule, not a frozen list', async () => {
    const under = (await getCollectionBySlug('under-50k'))!;
    expect(under.rule.kind).toBe('dynamic');
    const { items } = await listProducts({ ...collectionQuery(under), perPage: 500 });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.priceFrom <= 5_000_000)).toBe(true);
  });

  it('23. summaries carry live counts and real imagery, and drop empties', async () => {
    const summaries = await getCollectionSummaries({ store });
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      expect(summary.productCount).toBeGreaterThan(0);
      expect(summary.previewImages.length).toBeGreaterThan(0);
    }
  });
});

describe('collection pages', () => {
  it('24. a known slug loads its own members only', async () => {
    const view = (await collectionView('desk-setup'))!;
    const desk = (await getCollectionBySlug('desk-setup'))!;
    const ids = new Set(desk.rule.productIds);

    expect(view.result.total).toBe(ids.size);
    expect(view.result.items.every((p) => ids.has(p.id))).toBe(true);
  });

  it('25. an unknown slug resolves to null, so the route can 404', async () => {
    expect(await resolveCollectionScope('not-a-collection', store)).toBeNull();
    expect(await collectionView('nonexistent')).toBeNull();
  });

  it('26. the collection rule survives a hostile query string', async () => {
    // Someone appending ?maxPrice=2000000 to /collections/under-50k must not
    // escape the collection's own ceiling.
    const view = (await collectionView('under-50k', '?maxPrice=2000000'))!;
    expect(view.result.total).toBeGreaterThan(0);
    expect(view.result.items.every((p) => p.priceFrom <= 5_000_000)).toBe(true);
  });

  it('27. a shopper filter narrows within the collection', async () => {
    const base = (await collectionView('travel-essentials'))!;
    const filtered = (await collectionView('travel-essentials', '?stock=1'))!;
    const travel = (await getCollectionBySlug('travel-essentials'))!;
    const ids = new Set(travel.rule.productIds);

    expect(filtered.result.total).toBeLessThanOrEqual(base.result.total);
    expect(filtered.result.items.every((p) => ids.has(p.id) && p.inStock)).toBe(true);
  });

  it('28. sorting and search work inside a collection', async () => {
    const sorted = (await collectionView('staff-picks', '?sort=price-desc'))!;
    const prices = sorted.result.items.map((p) => p.priceTo);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));

    const searched = (await collectionView('home-refresh', '?q=linen'))!;
    expect(searched.result.total).toBeGreaterThan(0);
    const home = (await getCollectionBySlug('home-refresh'))!;
    expect(searched.result.items.every((p) => home.rule.productIds!.includes(p.id))).toBe(true);
  });

  it('29. clearing filters returns to the collection, not the whole store', async () => {
    const view = (await collectionView('gifts-for-her', '?stock=1&rating=4'))!;
    expect(view.clearHref).toBe('/collections/gifts-for-her?sort=rating');

    const cleared = (await collectionView('gifts-for-her', '?sort=rating'))!;
    const gifts = (await getCollectionBySlug('gifts-for-her'))!;
    expect(cleared.result.total).toBe(gifts.rule.productIds!.length);
  });

  it('30. the landing rail is the collection’s own opening run', async () => {
    const collection = (await getCollectionBySlug('travel-essentials'))!;
    const landing = await getCollectionLanding({ store, collection, limit: 4 });

    expect(landing.highlights).toHaveLength(4);
    expect(landing.highlights.every((p) => collection.rule.productIds!.includes(p.id))).toBe(true);
    expect(landing.productCount).toBe(collection.rule.productIds!.length);
  });

  it('31. the "on sale" collection contains only reduced products', async () => {
    const view = (await collectionView('sale'))!;
    expect(view.result.total).toBeGreaterThan(0);
    expect(view.result.items.every((p) => p.tags.includes('sale'))).toBe(true);
  });

  it('32. facets on a collection page describe the collection, not the store', async () => {
    const view = (await collectionView('desk-setup'))!;
    const storeWide = await listProducts({ perPage: 1 });

    expect(view.result.facets.priceMin).toBeGreaterThanOrEqual(storeWide.facets.priceMin);
    expect(view.result.facets.brands.length).toBeLessThan(storeWide.facets.brands.length);
  });
});

/* ───────────────────── existing behaviour, unbroken ───────────────────── */

describe('Phase 2 surfaces still behave', () => {
  it('33. search is unaffected by the new pinned-scope plumbing', async () => {
    const { result, criteria } = await view('/search?q=kettlebell');
    expect(result.total).toBeGreaterThan(0);
    expect(result.items[0].name).toContain('Kettlebell');
    expect(criteria.scope).toBeUndefined();
  });

  it('34. option (variant) filters still work alongside spec filters', async () => {
    const { result, criteria } = await view('/products?colour=black&fit=slim');
    expect(criteria.optionValueIds).toHaveLength(2);
    expect(result.total).toBeGreaterThan(0);
    expect(
      result.items.every(
        (p) =>
          p.options.some((o) => o.values.some((v) => v.id === 'ov_col_black')) &&
          p.specs.some((s) => s.label === 'Fit' && s.value === 'Slim'),
      ),
    ).toBe(true);
  });

  it('35. category and collection views share one engine', async () => {
    // Same shape, same fields, built by the same call — if these diverge,
    // a fix to one page silently misses the other.
    const category = await categoryView(['beauty']);
    const collection = (await collectionView('staff-picks'))!;
    expect(Object.keys(category).sort()).toEqual(Object.keys(collection).sort());
  });

  it('36. every category slug used by a collection rule exists', async () => {
    for (const collection of COLLECTIONS) {
      const path = collection.rule.match?.categoryPath;
      if (!path) continue;
      expect(CATEGORY_BY_SLUG.get(path[path.length - 1]), collection.slug).toBeDefined();
    }
  });
});
