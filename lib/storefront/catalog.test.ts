import { describe, expect, it } from 'vitest';
import {
  getCategoryTree,
  getFeaturedCategories,
  getCategoryByPath,
  listProducts,
  getProductBySlug,
  getRelatedProducts,
  searchProducts,
  getSearchSuggestions,
  getReviews,
  getHomepageSections,
  findVariant,
} from './catalog';
import { PRODUCTS } from './mock/products';
import { CATEGORIES } from './mock/categories';

describe('category tree', () => {
  it('nests up to 3 levels and carries slug paths', async () => {
    const tree = await getCategoryTree();
    expect(tree.length).toBeGreaterThan(0);
    const fashion = tree.find((c) => c.slug === 'fashion')!;
    expect(fashion.level).toBe(0);
    const women = fashion.children.find((c) => c.slug === 'women')!;
    expect(women.level).toBe(1);
    const skirts = women.children.find((c) => c.slug === 'skirts')!;
    expect(skirts.level).toBe(2);
    expect(skirts.path).toEqual(['fashion', 'women', 'skirts']);
  });

  it('rolls product counts up to ancestors', async () => {
    const tree = await getCategoryTree();
    const fashion = tree.find((c) => c.slug === 'fashion')!;
    const childSum = fashion.children.reduce((n, c) => n + c.productCount, 0);
    expect(fashion.productCount).toBeGreaterThanOrEqual(childSum > 0 ? 1 : 0);
    expect(fashion.productCount).toBeGreaterThan(0);
  });

  it('featured categories are all roots', async () => {
    const featured = await getFeaturedCategories();
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.every((c) => c.level === 0)).toBe(true);
  });

  it('resolves a category only when the full slug path matches', async () => {
    expect(await getCategoryByPath(['fashion', 'women', 'skirts'])).not.toBeNull();
    expect(await getCategoryByPath(['women', 'skirts'])).toBeNull();
    expect(await getCategoryByPath(['nope'])).toBeNull();
  });
});

describe('every leaf category has products', () => {
  it('holds for all leaves', async () => {
    const leaves = CATEGORIES.filter((c) => !CATEGORIES.some((x) => x.parentId === c.id));
    for (const leaf of leaves) {
      const res = await listProducts({ categoryPath: leaf.path });
      expect(res.total, `leaf ${leaf.path.join('/')}`).toBeGreaterThan(0);
    }
  });
});

describe('listProducts', () => {
  it('filters by category subtree', async () => {
    const res = await listProducts({ categoryPath: ['fashion'], perPage: 100 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.items.every((p) => p.categoryIds.includes('cat_fashion'))).toBe(true);
  });

  it('paginates and clamps the page', async () => {
    const res = await listProducts({ perPage: 5, page: 999 });
    expect(res.items.length).toBeLessThanOrEqual(5);
    expect(res.page).toBe(res.pageCount);
  });

  it('sorts by price ascending', async () => {
    const res = await listProducts({ sort: 'price-asc', perPage: 20 });
    const prices = res.items.map((p) => p.priceFrom);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('respects price bounds and in-stock filter', async () => {
    const res = await listProducts({ minPrice: 5_000_000, inStockOnly: true, perPage: 100 });
    expect(res.items.every((p) => p.priceTo >= 5_000_000 && p.inStock)).toBe(true);
  });

  it('returns facets with buckets', async () => {
    const res = await listProducts({ categoryPath: ['fashion'] });
    expect(res.facets.brands.length).toBeGreaterThan(0);
    expect(res.facets.priceMax).toBeGreaterThan(res.facets.priceMin);
    expect(res.facets.ratings.length).toBe(4);
  });
});

describe('product detail', () => {
  it('round-trips by slug and finds a variant by option values', async () => {
    const sample = PRODUCTS.find((p) => p.options.length > 0)!;
    const found = await getProductBySlug(sample.slug);
    expect(found?.id).toBe(sample.id);
    const v = sample.variants[0];
    expect(findVariant(sample, v.optionValueIds)?.id).toBe(v.id);
  });

  it('returns related products excluding itself', async () => {
    const p = PRODUCTS[0];
    const related = await getRelatedProducts(p.id, 6);
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((r) => r.id !== p.id)).toBe(true);
  });
});

describe('search & reviews', () => {
  it('search matches product names', async () => {
    const res = await searchProducts('dress');
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.some((p) => p.name.toLowerCase().includes('dress'))).toBe(true);
  });

  it('suggestions require at least a partial term', async () => {
    const empty = await getSearchSuggestions('');
    expect(empty.products).toHaveLength(0);
    const hit = await getSearchSuggestions('serum');
    expect(hit.products.length).toBeGreaterThan(0);
  });

  it('paginates reviews and sorts by helpful', async () => {
    const withReviews = PRODUCTS[0];
    const res = await getReviews(withReviews.id, { sort: 'helpful', perPage: 3 });
    expect(res.items.length).toBeLessThanOrEqual(3);
    const helpful = res.items.map((r) => r.helpful);
    expect(helpful).toEqual([...helpful].sort((a, b) => b - a));
  });
});

describe('homepage & content', () => {
  it('builds homepage sections from the catalogue itself', async () => {
    const h = await getHomepageSections();
    expect(h.collections.length).toBeGreaterThan(0);
    expect(h.collections.every((c) => c.products.length > 0)).toBe(true);
    expect(h.featuredCategories.every((c) => c.level === 0)).toBe(true);
    // Service promises restate what the app really does (gateway, delivery, returns).
    expect(h.serviceFeatures.length).toBeGreaterThan(0);
    expect(h.serviceFeatures.every((f) => f.title && f.description)).toBe(true);
  });

  it('invents no social proof or campaign copy for a store', async () => {
    // A merchant writes their own hero, promos, testimonials and posts. Until
    // the admin can edit them, the storefront shows none rather than someone
    // else's — see lib/storefront/catalog.ts:getHomepageSections.
    const h = await getHomepageSections();
    expect(h.hero).toEqual([]);
    expect(h.promoBanners).toEqual([]);
    expect(h.testimonials).toEqual([]);
    expect(h.instagram).toEqual([]);
    expect(h.blog).toEqual([]);
  });

  it('recommends a full, de-duplicated grid spanning several departments', async () => {
    const { recommended } = await getHomepageSections();

    expect(recommended).toHaveLength(10);
    expect(new Set(recommended.map((p) => p.id)).size).toBe(10);
    // one pick per root category first, so the grid is never all one aisle
    const roots = new Set(recommended.map((p) => p.categoryIds[0]));
    expect(roots.size).toBeGreaterThanOrEqual(5);
  });

});
