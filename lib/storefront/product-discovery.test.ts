import { beforeAll, describe, expect, it } from 'vitest';
import { discoverProducts, getEmptyStateOptions } from './product-discovery';
import { getOptionIndex } from './catalog';
import { EMPTY_CRITERIA, parseDiscoveryParams, type DiscoveryCriteria } from './discovery-url';
import type { OptionIndex, StoreScope } from './types';

const store: StoreScope = { organizationSlug: 'demo' };
let index: OptionIndex;

/** Drive the service exactly as a page does: from a URL. */
const view = (url: string, defaults: Partial<DiscoveryCriteria> = {}) => {
  const { pathname, searchParams } = new URL(url, 'https://shop.demo.test');
  const raw = Object.fromEntries([...searchParams.keys()].map((k) => [k, searchParams.getAll(k)]));
  return discoverProducts({
    store,
    pathname,
    criteria: parseDiscoveryParams(raw, index, defaults),
  });
};

beforeAll(async () => {
  index = await getOptionIndex();
});

describe('search scenarios', () => {
  it('1. searches by product name', async () => {
    const { result } = await view('/search?q=kettlebell');
    expect(result.total).toBeGreaterThan(0);
    expect(result.items[0].name).toContain('Kettlebell');
  });

  it('2. searches by brand', async () => {
    const { result } = await view('/search?q=Maison%20Verte');
    expect(result.total).toBeGreaterThan(0);
  });

  it('3. searches by category', async () => {
    const { result } = await view('/search?q=headphones');
    expect(result.total).toBeGreaterThan(0);
  });

  it('4. searches with multiple words', async () => {
    const { result } = await view('/search?q=cast+iron+dutch+oven');
    expect(result.total).toBeGreaterThan(0);
    expect(result.items[0].name).toContain('Dutch Oven');
  });

  it('5. returns an honest zero for no results', async () => {
    const { result } = await view('/search?q=blue+gaming+refrigerator');
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('6. with no query, returns the full catalogue rather than nothing', async () => {
    const { result } = await view('/search');
    expect(result.total).toBeGreaterThan(40);
  });
});

describe('filter scenarios', () => {
  it('7. applies one filter', async () => {
    const { result } = await view('/products?stock=1');
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((p) => p.inStock)).toBe(true);
  });

  it('8. applies multiple filters together', async () => {
    const { result, criteria } = await view('/products?colour=black&rating=4&stock=1');
    expect(criteria.optionValueIds).toHaveLength(1);
    expect(
      result.items.every(
        (p) =>
          p.inStock &&
          p.rating.average >= 4 &&
          p.options.some((o) => o.values.some((v) => v.id === criteria.optionValueIds[0])),
      ),
    ).toBe(true);
  });

  it('9. a chip removes exactly its own filter', async () => {
    const { activeFilters } = await view('/products?colour=black&brand=aeris&stock=1');
    expect(activeFilters).toHaveLength(3);
    const colourChip = activeFilters.find((f) => f.label === 'Black')!;
    expect(colourChip.removeHref).toContain('brand=aeris');
    expect(colourChip.removeHref).toContain('stock=1');
    expect(colourChip.removeHref).not.toContain('colour=');
  });

  it('10. clear-all drops every filter but keeps the query', async () => {
    const { clearHref } = await view('/search?q=coat&colour=black&brand=aeris&rating=4');
    expect(clearHref).toBe('/search?q=coat');
  });

  it('filters by a price ceiling', async () => {
    const { result } = await view('/products?maxPrice=20000');
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((p) => p.priceFrom <= 20_000_00)).toBe(true);
  });

  it('only offers facets the current results actually have', async () => {
    const electronics = await view('/c/electronics', { categoryPath: ['electronics'] });
    const beauty = await view('/c/beauty', { categoryPath: ['beauty'] });
    const names = (v: typeof electronics) => v.result.facets.options.map((o) => o.name);
    // Storage is an electronics option; it must not appear on beauty.
    expect(names(electronics)).toContain('Storage');
    expect(names(beauty)).not.toContain('Storage');
  });
});

describe('sort scenarios', () => {
  const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

  it('11/12. sorts by price both ways', async () => {
    const asc = (await view('/products?sort=price-asc')).result.items.map((p) => p.priceFrom);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = (await view('/products?sort=price-desc')).result.items.map((p) => p.priceTo);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it('13. sorts by newest', async () => {
    const dates = (await view('/products?sort=newest')).result.items.map((p) => +new Date(p.createdAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('14. sorts by rating', async () => {
    const rated = (await view('/products?sort=rating')).result.items.map((p) => p.rating.average);
    expect(rated).toEqual([...rated].sort((a, b) => b - a));
  });

  it('sorts by popularity using real sales', async () => {
    const sold = (await view('/products?sort=bestselling')).result.items.map((p) => p.soldCount);
    expect(sold).toEqual([...sold].sort((a, b) => b - a));
  });

  it('relevance is a real ranking, not fixture order', async () => {
    const relevance = ids((await view('/search?q=dress')).result);
    const price = ids((await view('/search?q=dress&sort=price-asc')).result);
    expect(relevance.length).toBeGreaterThan(1);
    expect(relevance).not.toEqual(price);
    expect([...relevance].sort()).toEqual([...price].sort());
  });

  it('15. combines search + filters + sorting', async () => {
    const { result, criteria } = await view('/search?q=jacket&stock=1&sort=price-asc');
    expect(criteria.q).toBe('jacket');
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((p) => p.inStock)).toBe(true);
    const prices = result.items.map((p) => p.priceFrom);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

describe('16/17. URL state survives a refresh or a paste into a new tab', () => {
  it('reproduces an identical result set from the URL alone', async () => {
    const url = '/search?q=coat&brand=aeris&colour=black&maxPrice=200000&sort=price-asc&page=1';
    const a = await view(url);
    const b = await view(url);
    expect(b.result.items.map((p) => p.id)).toEqual(a.result.items.map((p) => p.id));
    expect(b.criteria).toEqual(a.criteria);
    expect(b.activeFilters.map((f) => f.label)).toEqual(a.activeFilters.map((f) => f.label));
  });

  it('clamps an out-of-range page instead of showing an empty grid', async () => {
    const { result } = await view('/products?page=9999');
    expect(result.page).toBe(result.pageCount);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('pages without losing the rest of the state', async () => {
    const { pageHref } = await view('/search?q=dress&sort=price-asc');
    const next = pageHref(2);
    expect(next).toContain('q=dress');
    expect(next).toContain('sort=price-asc');
    expect(next).toContain('page=2');
  });
});

describe('18. category browsing shares the engine', () => {
  it('scopes to the category subtree and lists its children', async () => {
    const { result, category, childCategories } = await view('/c/fashion', {
      categoryPath: ['fashion'],
    });
    expect(category?.slug).toBe('fashion');
    expect(childCategories.length).toBeGreaterThan(0);
    expect(result.items.every((p) => p.categoryIds.includes('cat_fashion'))).toBe(true);
  });

  it('applies search within a category', async () => {
    const { result } = await view('/c/electronics?q=laptop', { categoryPath: ['electronics'] });
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((p) => p.categoryIds.includes('cat_electronics'))).toBe(true);
  });
});

describe('23. empty-state recovery only offers paths that work', () => {
  it('offers filter removal when that genuinely finds products', async () => {
    const criteria = parseDiscoveryParams({ q: 'dress', maxPrice: '1' }, index);
    const options = await getEmptyStateOptions({
      store,
      criteria,
      pathname: '/search',
      optionIndex: index,
    });
    expect(options.withoutFilters).not.toBeNull();
    expect(options.withoutFilters!.total).toBeGreaterThan(0);
    expect(options.withoutFilters!.href).toContain('q=dress');
    expect(options.withoutFilters!.href).not.toContain('maxPrice');
  });

  it('offers nothing at all for genuine nonsense', async () => {
    const criteria = parseDiscoveryParams({ q: 'blue gaming refrigerator' }, index);
    const options = await getEmptyStateOptions({
      store,
      criteria,
      pathname: '/search',
      optionIndex: index,
    });
    expect(options.withoutFilters).toBeNull();
    expect(options.broaderQuery).toBeNull();
  });
});
