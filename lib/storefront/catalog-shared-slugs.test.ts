/*
 * Two parents may each have a category with the same web name — a perfume
 * shop's "women/eau-de-parfum" and "men/eau-de-parfum". Each address must
 * open its own category and list its own products; looking one up by the last
 * segment alone made the earlier one a "couldn't find that page".
 */
import { describe, expect, it, vi } from 'vitest';
import { buildCatalogue } from './data/catalogue';
import { CATEGORIES } from './mock/categories';
import { PRODUCTS } from './mock/products';
import type { Category } from './types';

const womenSkirts = CATEGORIES.find((c) => c.path.join('/') === 'fashion/women/skirts')!;
const men = CATEGORIES.find((c) => c.path.join('/') === 'fashion/men')!;
// Men › Skirts, with the same slug as Women › Skirts, added AFTER it.
const menSkirts: Category = { ...womenSkirts, id: 'men-skirts', parentId: men.id, path: ['fashion', 'men', 'skirts'] };
const womenProduct = PRODUCTS.find((p) => p.categoryIds.includes(womenSkirts.id))!;
const menProduct = { ...PRODUCTS.find((p) => p.id !== womenProduct.id)!, categoryIds: [menSkirts.id] };

const catalogue = buildCatalogue({
  organizationSlug: 'demo',
  storeName: 'Demo',
  currency: 'NGN',
  products: PRODUCTS.map((p) => (p.id === menProduct.id ? menProduct : p)),
  categories: [...CATEGORIES, menSkirts],
  brands: [],
  collections: [],
});

vi.mock('./data/current', () => ({
  getCatalogue: async () => catalogue,
  resolveStoreSlug: async () => 'demo',
}));

const { getCategoryByPath, listProducts } = await import('./catalog');

describe('categories that share a web name under different parents', () => {
  it('opens each one at its own address', async () => {
    expect((await getCategoryByPath(['fashion', 'women', 'skirts']))?.id).toBe(womenSkirts.id);
    expect((await getCategoryByPath(['fashion', 'men', 'skirts']))?.id).toBe('men-skirts');
    expect(await getCategoryByPath(['fashion', 'kids', 'skirts'])).toBeNull();
  });

  it('lists only that category’s products', async () => {
    const women = await listProducts({ categoryPath: ['fashion', 'women', 'skirts'] });
    const ids = women.items.map((p) => p.id);
    expect(ids).toContain(womenProduct.id);
    expect(ids).not.toContain(menProduct.id);

    const menList = await listProducts({ categoryPath: ['fashion', 'men', 'skirts'] });
    expect(menList.items.map((p) => p.id)).toEqual([menProduct.id]);
  });
});
