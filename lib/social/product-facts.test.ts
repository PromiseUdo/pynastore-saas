/*
 * Product facts: ownership, and the product URL.
 *
 * Two things the copywriter and the publisher both depend on:
 *
 *   1. a product is found only when the store asking owns it — the query
 *      pairs the product id with the organizationId, so a guessed id is a
 *      miss rather than another merchant's catalogue;
 *   2. the storefront link is BUILT here, from the store's own domain. The
 *      client never supplies a URL, so there is nothing to tamper with.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const items: Record<string, unknown>[] = [];
const pages: Record<string, unknown>[] = [];

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (expected && typeof expected === 'object') {
      const condition = expected as { not?: unknown };
      if ('not' in condition && row[key] === condition.not) return false;
      continue;
    }
    if (row[key] !== expected) return false;
  }
  return true;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    inventoryItem: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        items.find((row) => matches(row, where)) ?? null,
    },
    category: {
      findMany: async () => [
        { id: 'cat_dresses', name: 'Dresses', parentId: 'cat_clothing' },
        { id: 'cat_clothing', name: 'Clothing', parentId: null },
      ],
    },
    storePage: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        pages.find((row) => matches(row, where)) ?? null,
    },
  },
}));

const { getProductFacts, resolveImageUrls } = await import('./product-facts');

const ORG_A = { name: 'Adire Studio', slug: 'adire', customStoreDomain: null };

function addProduct(id: string, organizationId: string, overrides: Record<string, unknown> = {}) {
  items.push({
    id,
    organizationId,
    parentItemId: null,
    name: 'Ankara Wrap Dress',
    description: 'A wrap dress.',
    shortDescription: null,
    highlights: ['Adjustable waist tie'],
    specs: [{ label: 'Fabric', value: '100% cotton' }],
    tags: ['ankara'],
    slug: 'ankara-wrap-dress',
    isPublished: true,
    sellingPrice: 24500,
    categoryId: 'cat_dresses',
    variantOptions: [{ name: 'Size', values: [{ label: 'S' }, { label: 'M' }] }],
    brand: { name: 'Adire Studio' },
    images: [
      { id: 'img1', url: 'https://cdn.example.com/1.jpg', alt: 'Front' },
      { id: 'img2', url: 'https://cdn.example.com/2.jpg', alt: null },
    ],
    variants: [],
    organization: ORG_A,
    ...overrides,
  });
}

beforeEach(() => {
  items.length = 0;
  pages.length = 0;
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'app.example.com';
});

describe('ownership', () => {
  it('finds a product the store owns', async () => {
    addProduct('p1', 'org_a');
    const facts = await getProductFacts('org_a', 'p1');
    expect(facts?.name).toBe('Ankara Wrap Dress');
  });

  it('does not find another store’s product, even with the right id', async () => {
    addProduct('p1', 'org_a');
    expect(await getProductFacts('org_b', 'p1')).toBeNull();
  });

  it('does not find a variant — only top-level products can be posted', async () => {
    addProduct('v1', 'org_a', { parentItemId: 'p1' });
    expect(await getProductFacts('org_a', 'v1')).toBeNull();
  });
});

describe('the facts handed to the model', () => {
  it('formats the price instead of passing a bare number', async () => {
    addProduct('p1', 'org_a');
    const facts = await getProductFacts('org_a', 'p1');

    expect(facts?.priceLabel).toContain('24,500');
    expect(facts?.priceLabel).not.toBe('24500');
  });

  it('reports a range when variants are priced differently', async () => {
    addProduct('p1', 'org_a', {
      sellingPrice: null,
      variants: [{ sellingPrice: 20000 }, { sellingPrice: 30000 }],
    });
    const facts = await getProductFacts('org_a', 'p1');

    expect(facts?.priceLabel).toContain('20,000');
    expect(facts?.priceLabel).toContain('30,000');
  });

  it('has no price at all when none is set, rather than a zero', async () => {
    addProduct('p1', 'org_a', { sellingPrice: null, variants: [] });
    expect((await getProductFacts('org_a', 'p1'))?.priceLabel).toBeNull();
  });

  it('reads the category path and the variant options', async () => {
    addProduct('p1', 'org_a');
    const facts = await getProductFacts('org_a', 'p1');

    expect(facts?.categoryPath).toEqual(['Clothing', 'Dresses']);
    expect(facts?.variantSummary).toEqual(['Size: S, M']);
    expect(facts?.specs).toEqual(['Fabric: 100% cotton']);
  });

  it('uses the merchant’s published About page as the shop description', async () => {
    addProduct('p1', 'org_a');
    pages.push({ organizationId: 'org_a', kind: 'ABOUT', isPublished: true, body: 'We make wax-print clothing.' });

    expect((await getProductFacts('org_a', 'p1'))?.storeDescription).toBe('We make wax-print clothing.');
  });

  it('has no shop description when the About page isn’t published', async () => {
    addProduct('p1', 'org_a');
    pages.push({ organizationId: 'org_a', kind: 'ABOUT', isPublished: false, body: 'Draft.' });

    expect((await getProductFacts('org_a', 'p1'))?.storeDescription).toBeNull();
  });
});

describe('the product URL', () => {
  it('is built from the platform subdomain by default', async () => {
    addProduct('p1', 'org_a');
    expect((await getProductFacts('org_a', 'p1'))?.productUrl).toBe(
      'https://shop.adire.app.example.com/products/ankara-wrap-dress',
    );
  });

  it('uses the merchant’s own domain when they have one', async () => {
    addProduct('p1', 'org_a', {
      organization: { ...ORG_A, customStoreDomain: 'shop.adire.com' },
    });
    expect((await getProductFacts('org_a', 'p1'))?.productUrl).toBe(
      'https://shop.adire.com/products/ankara-wrap-dress',
    );
  });

  it('is null for an unpublished product, rather than a link that 404s', async () => {
    addProduct('p1', 'org_a', { isPublished: false });
    const facts = await getProductFacts('org_a', 'p1');

    expect(facts?.productUrl).toBeNull();
    expect(facts?.isPublished).toBe(false);
  });

  it('is null when the product has no web address yet', async () => {
    addProduct('p1', 'org_a', { slug: null });
    expect((await getProductFacts('org_a', 'p1'))?.productUrl).toBeNull();
  });
});

describe('resolveImageUrls', () => {
  it('returns only images the product owns, in the product’s order', async () => {
    addProduct('p1', 'org_a');
    const facts = (await getProductFacts('org_a', 'p1'))!;

    expect(resolveImageUrls(facts, ['img2', 'img1'])).toEqual([
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.jpg',
    ]);
  });

  it('silently drops an id that isn’t on this product', async () => {
    addProduct('p1', 'org_a');
    const facts = (await getProductFacts('org_a', 'p1'))!;

    expect(resolveImageUrls(facts, ['someone-elses-image', 'img1'])).toEqual(['https://cdn.example.com/1.jpg']);
    expect(resolveImageUrls(facts, ['someone-elses-image'])).toEqual([]);
  });
});
