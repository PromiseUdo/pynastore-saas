import { describe, expect, it } from 'vitest';
import {
  buildCategoryTree,
  depthOf,
  flattenCategoryTree,
  parentProblem,
  slugify,
  storefrontCategoryPath,
  subtreeHeight,
  uniqueSlug,
  type CategoryNodeInput,
} from './category-tree';

const row = (id: string, parentId: string | null, sortOrder = 0, name = id): CategoryNodeInput => ({
  id,
  name,
  slug: id,
  parentId,
  sortOrder,
});

// fashion > women > skirts ; fashion > men ; home
const rows = [
  row('fashion', null, 0),
  row('women', 'fashion', 1),
  row('men', 'fashion', 0),
  row('skirts', 'women'),
  row('home', null, 1),
];

describe('slugify', () => {
  it('makes URL-safe slugs from merchant-typed names', () => {
    expect(slugify("Men's T‑Shirts & Polos")).toBe('mens-t-shirts-and-polos');
    expect(slugify('  Café  Décor ')).toBe('cafe-decor');
    expect(slugify('!!!')).toBe('category');
  });
});

describe('buildCategoryTree', () => {
  it('nests, orders siblings by sortOrder, and carries name/slug paths', () => {
    const tree = buildCategoryTree(rows);
    expect(tree.map((n) => n.id)).toEqual(['fashion', 'home']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['men', 'women']);
    const skirts = flattenCategoryTree(tree).find((n) => n.id === 'skirts')!;
    expect(skirts.depth).toBe(2);
    expect(skirts.slugPath).toEqual(['fashion', 'women', 'skirts']);
    expect(storefrontCategoryPath(skirts.slugPath)).toBe('/c/fashion/women/skirts');
  });

  it('promotes orphans instead of dropping them', () => {
    const tree = buildCategoryTree([row('lost', 'missing')]);
    expect(tree.map((n) => n.id)).toEqual(['lost']);
  });
});

describe('depth rules', () => {
  it('measures depth and subtree height', () => {
    expect(depthOf(rows, 'skirts')).toBe(2);
    expect(subtreeHeight(rows, 'fashion')).toBe(3);
    expect(subtreeHeight(rows, 'home')).toBe(1);
  });

  it('allows a new category down to the third level only', () => {
    expect(parentProblem(rows, null, null)).toBeNull();
    expect(parentProblem(rows, null, 'women')).toBeNull();
    expect(parentProblem(rows, null, 'skirts')).toMatch(/3 levels/);
  });

  it('counts the moved category’s own subcategories', () => {
    // women (2 levels) under home (depth 0) → fits
    expect(parentProblem(rows, 'women', 'home')).toBeNull();
    // fashion (3 levels) under home → 4 levels
    expect(parentProblem(rows, 'fashion', 'home')).toMatch(/counting its subcategories/);
  });

  it('refuses cycles', () => {
    expect(parentProblem(rows, 'fashion', 'fashion')).toMatch(/inside itself/);
    expect(parentProblem(rows, 'fashion', 'skirts')).toMatch(/own subcategories/);
  });
});

describe('uniqueSlug', () => {
  it('suffixes only on collision', () => {
    expect(uniqueSlug('shoes', ['bags'])).toBe('shoes');
    expect(uniqueSlug('shoes', ['shoes', 'shoes-2'])).toBe('shoes-3');
  });
});
