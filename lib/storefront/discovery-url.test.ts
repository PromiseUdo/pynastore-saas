import { beforeAll, describe, expect, it } from 'vitest';
import { getOptionIndex } from './catalog';
import {
  EMPTY_CRITERIA,
  buildHref,
  clearFilters,
  criteriaToQuery,
  hasActiveFilters,
  parseDiscoveryParams,
  patchCriteria,
  toSearchParams,
  toggleInList,
  type DiscoveryCriteria,
} from './discovery-url';
import type { OptionIndex } from './types';

let index: OptionIndex;
let black: string;

beforeAll(async () => {
  index = await getOptionIndex();
  black = index.find((e) => e.key === 'colour')!.values.find((v) => v.key === 'black')!.id;
});

describe('option index', () => {
  it('derives readable url keys from the catalogue', () => {
    const colour = index.find((e) => e.key === 'colour')!;
    expect(colour.name).toBe('Colour');
    expect(colour.values.map((v) => v.key)).toContain('black');
    const storage = index.find((e) => e.key === 'storage');
    expect(storage?.values.map((v) => v.key)).toContain('256gb');
  });
});

describe('parsing', () => {
  it('reads the full documented URL shape', () => {
    const c = parseDiscoveryParams(
      { q: 'black sneakers', brand: 'orbit', colour: 'black', maxPrice: '100000', sort: 'price-asc' },
      index,
    );
    expect(c.q).toBe('black sneakers');
    expect(c.brandSlugs).toEqual(['orbit']);
    expect(c.optionValueIds).toEqual([black]);
    expect(c.maxPrice).toBe(10_000_000); // major → minor units
    expect(c.sort).toBe('price-asc');
    expect(c.page).toBe(1);
  });

  it('accepts repeated and comma-joined list params alike', () => {
    const a = parseDiscoveryParams({ brand: ['orbit', 'lumen'] }, index);
    const b = parseDiscoveryParams({ brand: 'orbit,lumen' }, index);
    expect(a.brandSlugs).toEqual(b.brandSlugs);
    expect(a.brandSlugs).toEqual(['orbit', 'lumen']);
  });

  it('ignores malformed values instead of throwing', () => {
    const c = parseDiscoveryParams(
      { sort: 'by-vibes', page: '-3', rating: '9', maxPrice: 'free', colour: 'chartreuse', tag: 'nope' },
      index,
    );
    expect(c.sort).toBe('relevance');
    expect(c.page).toBe(1);
    expect(c.minRating).toBeUndefined();
    expect(c.maxPrice).toBeUndefined();
    expect(c.optionValueIds).toEqual([]);
    expect(c.tag).toBeUndefined();
  });

  it('reads rating, stock and tag', () => {
    const c = parseDiscoveryParams({ rating: '4', stock: '1', tag: 'sale' }, index);
    expect(c.minRating).toBe(4);
    expect(c.inStockOnly).toBe(true);
    expect(c.tag).toBe('sale');
  });
});

describe('serialising', () => {
  it('round-trips every field', () => {
    const original: DiscoveryCriteria = {
      ...EMPTY_CRITERIA,
      q: 'wool coat',
      brandSlugs: ['aeris'],
      optionValueIds: [black],
      minPrice: 5_000_00,
      maxPrice: 100_000_00,
      minRating: 4,
      inStockOnly: true,
      tag: 'sale',
      sort: 'price-desc',
      page: 3,
    };
    const raw = Object.fromEntries(toSearchParams(original, index));
    const parsed = parseDiscoveryParams(raw, index);
    expect(parsed).toEqual(original);
  });

  it('omits defaults so a clean listing has a clean URL', () => {
    expect(buildHref('/c/fashion', EMPTY_CRITERIA, index)).toBe('/c/fashion');
  });

  it('writes prices in readable major units', () => {
    const qs = toSearchParams({ ...EMPTY_CRITERIA, maxPrice: 100_000_00 }, index).toString();
    expect(qs).toBe('maxPrice=100000');
  });

  /*
   * A route may pin its own query parameter on the pathname — /search/image
   * carries the visual query there. Every filter, sort and pager href is
   * built through here, so dropping it would throw away the shopper's image
   * search the moment they ticked a box.
   */
  it('keeps a parameter the route pinned on the pathname', () => {
    const href = buildHref('/search/image?vq=abc123', { ...EMPTY_CRITERIA, inStockOnly: true }, index);
    expect(href).toContain('stock=1');
    expect(href).toContain('vq=abc123');
    expect(href.startsWith('/search/image?')).toBe(true);
  });

  it('keeps a pinned parameter even when nothing is filtered', () => {
    expect(buildHref('/search/image?vq=abc123', EMPTY_CRITERIA, index)).toBe(
      '/search/image?vq=abc123',
    );
  });

  it('lets a real filter win over a pinned parameter of the same name', () => {
    const href = buildHref('/search?q=pinned', { ...EMPTY_CRITERIA, q: 'typed' }, index);
    expect(href).toBe('/search?q=typed');
  });
});

describe('mutation helpers', () => {
  it('resets to page 1 on any change but paging', () => {
    const on7 = { ...EMPTY_CRITERIA, page: 7 };
    expect(patchCriteria(on7, { sort: 'rating' }).page).toBe(1);
    expect(patchCriteria(on7, { page: 8 }).page).toBe(8);
  });

  it('toggles list values', () => {
    expect(toggleInList([], 'a')).toEqual(['a']);
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('clears filters but keeps the query and category context', () => {
    const c: DiscoveryCriteria = {
      ...EMPTY_CRITERIA,
      q: 'coat',
      categoryPath: ['fashion'],
      brandSlugs: ['aeris'],
      minRating: 4,
    };
    const cleared = clearFilters(c);
    expect(cleared.q).toBe('coat');
    expect(cleared.categoryPath).toEqual(['fashion']);
    expect(hasActiveFilters(cleared)).toBe(false);
    expect(hasActiveFilters(c)).toBe(true);
  });
});

describe('criteria → catalogue query', () => {
  it('carries the tenant scope through', () => {
    const q = criteriaToQuery(EMPTY_CRITERIA, { store: { organizationSlug: 'acme' }, perPage: 24 });
    expect(q.store).toEqual({ organizationSlug: 'acme' });
    expect(q.perPage).toBe(24);
  });

  it('sends undefined rather than empty arrays', () => {
    const q = criteriaToQuery(EMPTY_CRITERIA);
    expect(q.brandSlugs).toBeUndefined();
    expect(q.optionValueIds).toBeUndefined();
    expect(q.inStockOnly).toBeUndefined();
  });
});
