/*
 * Front-page sections against the real catalogue (ROADMAP 15.2).
 *
 * The rules that matter:
 *   - the two bands every shop had (bestselling, newest) pick exactly what
 *     the homepage always picked;
 *   - a band names a source and gets only what that source holds — a tag, a
 *     collection, a category, a brand — with a "View all" that goes there;
 *   - a source that was deleted, hidden, emptied or belongs to another shop
 *     gives no band at all, never an error and never a foreign product;
 *   - a shop's arranged sections come from its PUBLISHED design; a draft's
 *     only from the draft.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The real catalogue, not the demo fixtures vitest gets by default.
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';
import { prisma } from '@/lib/prisma';
import { getBrandShowcase, getHomepageSections, getSectionProducts, getStoreReviews } from '@/lib/storefront/catalog';
import { loadStorefrontDesign } from '@/lib/storefront/data/design';
import { classicSections } from '@/lib/storefront/sections/schema';
import { givePlan } from './helpers/plans';
import { giveStoreDelivery } from './helpers/delivery';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shop = { id: '', slug: `__test-sections-${suffix}` };
const other = { id: '', slug: `__test-sections-other-${suffix}` };
const ids: Record<string, string> = {};
const store = () => ({ organizationSlug: shop.slug });

async function product(organizationId: string, warehouseId: string, name: string, extra: Record<string, unknown> = {}) {
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId,
      name,
      sku: `${name}-${suffix}`.slice(0, 40),
      slug: `${name.toLowerCase().replace(/ /g, '-')}-${suffix}`.slice(0, 60),
      sellingPrice: 10000,
      isPublished: true,
      status: 'ACTIVE',
      ...extra,
    },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId, quantity: 10 } });
  return item.id;
}

beforeAll(async () => {
  for (const org of [shop, other]) {
    org.id = (await prisma.organization.create({ data: { name: 'Sections', slug: org.slug } })).id;
    await givePlan(org.id, 'pro');
  }
  const warehouse = await prisma.warehouse.create({
    data: { organizationId: shop.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' },
  });
  await giveStoreDelivery(shop.id);
  const otherWarehouse = await prisma.warehouse.create({
    data: { organizationId: other.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' },
  });
  await giveStoreDelivery(other.id);

  ids.dresses = (await prisma.category.create({ data: { organizationId: shop.id, name: 'Dresses', slug: 'dresses' } })).id;
  ids.hidden = (
    await prisma.category.create({ data: { organizationId: shop.id, name: 'Old', slug: 'old', isVisible: false } })
  ).id;
  ids.brand = (await prisma.brand.create({ data: { organizationId: shop.id, name: 'Adire Co', slug: 'adire-co' } })).id;

  ids.adire = await product(shop.id, warehouse.id, 'Adire Dress', { tags: ['bestseller'], categoryId: ids.dresses, brandId: ids.brand });
  ids.tote = await product(shop.id, warehouse.id, 'Raffia Tote', { tags: ['sale'] });
  ids.clutch = await product(shop.id, warehouse.id, 'Leather Clutch', { categoryId: ids.hidden });

  ids.picks = (
    await prisma.collection.create({
      data: {
        organizationId: shop.id,
        name: 'Picks',
        slug: 'picks',
        items: { create: [{ inventoryItemId: ids.tote, position: 0 }] },
      },
    })
  ).id;
  ids.emptyCollection = (await prisma.collection.create({ data: { organizationId: shop.id, name: 'Empty', slug: 'empty' } })).id;

  ids.foreignCategory = (await prisma.category.create({ data: { organizationId: other.id, name: 'Theirs', slug: 'theirs' } })).id;
  ids.foreignBag = await product(other.id, otherWarehouse.id, 'Foreign Bag', { categoryId: ids.foreignCategory });
  await prisma.brand.create({ data: { organizationId: shop.id, name: 'Nothing On Sale', slug: 'nothing-on-sale' } });

  /* Reviews: each needs a customer and an order behind it (one per shopper
   * per product), so a few minimal ones. */
  const review = async (organizationId: string, productId: string, rating: number, extra: Record<string, unknown> = {}) => {
    const customer = await prisma.customer.create({ data: { organizationId, name: `Shopper ${Math.random()}` } });
    const order = await prisma.order.create({
      data: { organizationId, reference: `R-${Math.random().toString(36).slice(2)}`, paymentMethod: 'pod', subtotal: 1, totalAmount: 1, customerId: customer.id },
    });
    await prisma.productReview.create({
      data: { organizationId, productId, customerId: customer.id, orderId: order.id, rating, title: `${rating} stars`, body: 'Exactly as described, arrived on time.', ...extra },
    });
  };
  await review(shop.id, ids.adire, 5);
  await review(shop.id, ids.tote, 3); // below the bar
  await review(shop.id, ids.adire, 4, { status: 'HIDDEN' }); // the merchant hid it
  await review(other.id, ids.foreignBag, 5); // another shop's
}, 120_000);

afterAll(async () => {
  for (const org of [shop, other]) {
    await prisma.productReview.deleteMany({ where: { organizationId: org.id } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
  }
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
  for (const org of [shop, other]) {
    await prisma.storefrontDesign.deleteMany({ where: { organizationId: org.id } });
    await prisma.collection.deleteMany({ where: { organizationId: org.id } });
    await prisma.inventoryLevel.deleteMany({ where: { inventoryItem: { organizationId: org.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.brand.deleteMany({ where: { organizationId: org.id } });
    await prisma.category.deleteMany({ where: { organizationId: org.id } });
  }
});

const names = (result: Awaited<ReturnType<typeof getSectionProducts>>) => result?.products.map((p) => p.name) ?? null;

describe('the bands every shop had', () => {
  it('pick exactly what the homepage always picked', async () => {
    const legacy = await getHomepageSections(store());
    const popular = await getSectionProducts({ kind: 'bestselling' }, store());
    const fresh = await getSectionProducts({ kind: 'newest' }, store());

    expect(popular?.products.map((p) => p.id)).toEqual(
      (legacy.collections.find((c) => c.key === 'bestsellers')?.products ?? legacy.recommended).map((p) => p.id),
    );
    expect(fresh?.products.map((p) => p.id)).toEqual(
      (legacy.collections.find((c) => c.key === 'new')?.products ?? legacy.recommended).map((p) => p.id),
    );
    expect(popular?.href).toBe('/products?sort=bestselling');
    expect(fresh?.href).toBe('/products?sort=newest');
  });
});

describe('a band built from a source', () => {
  it('shows a tag’s products', async () => {
    const result = await getSectionProducts({ kind: 'tag', tag: 'sale' }, store());
    expect(names(result)).toEqual(['Raffia Tote']);
    expect(result?.href).toBe('/products?tag=sale');
  });

  it('shows a collection’s products, linking to the collection', async () => {
    const result = await getSectionProducts({ kind: 'collection', id: ids.picks }, store());
    expect(names(result)).toEqual(['Raffia Tote']);
    expect(result?.href).toBe('/collections/picks');
  });

  it('shows a category’s products, linking to the category', async () => {
    const result = await getSectionProducts({ kind: 'category', id: ids.dresses }, store());
    expect(names(result)).toEqual(['Adire Dress']);
    expect(result?.href).toBe('/c/dresses');
  });

  it('shows a brand’s products', async () => {
    const result = await getSectionProducts({ kind: 'brand', id: ids.brand }, store());
    expect(names(result)).toEqual(['Adire Dress']);
    expect(result?.href).toBe('/products?brand=adire-co');
  });
});

describe('a source that can’t be shown', () => {
  it('gives no band for a hidden category, an empty collection or something deleted', async () => {
    expect(await getSectionProducts({ kind: 'category', id: ids.hidden }, store())).toBeNull();
    expect(await getSectionProducts({ kind: 'collection', id: ids.emptyCollection }, store())).toBeNull();
    expect(await getSectionProducts({ kind: 'collection', id: 'deleted-collection' }, store())).toBeNull();
    expect(await getSectionProducts({ kind: 'brand', id: 'deleted-brand' }, store())).toBeNull();
    expect(await getSectionProducts({ kind: 'tag', tag: 'limited' }, store())).toBeNull();
  });

  it('never shows another shop’s category or products', async () => {
    expect(await getSectionProducts({ kind: 'category', id: ids.foreignCategory }, store())).toBeNull();
  });
});

describe('which sections a shop shows', () => {
  const arranged = [
    { id: 'hero', type: 'hero', enabled: true, variant: 'full' },
    { id: 'sale', type: 'products', enabled: true, variant: 'carousel', title: 'On sale', source: { kind: 'tag', tag: 'sale' } },
  ];
  const design = (sections: object[]) => ({
    version: 2,
    look: 'classic',
    brandColour: null,
    darkByDefault: false,
    corners: null,
    fonts: null,
    cards: null,
    sections,
  });

  it('is Classic until a design with sections is published, and a draft only shows in preview', async () => {
    expect((await loadStorefrontDesign(shop.slug)).design.sections).toBeNull(); // → classicSections()

    await prisma.storefrontDesign.create({ data: { organizationId: shop.id, draft: design(arranged) } });
    expect((await loadStorefrontDesign(shop.slug)).design.sections).toBeNull();
    expect((await loadStorefrontDesign(shop.slug, 'draft')).design.sections).toEqual(arranged);

    await prisma.storefrontDesign.update({
      where: { organizationId: shop.id },
      data: { published: design(arranged) },
    });
    expect((await loadStorefrontDesign(shop.slug)).design.sections).toEqual(arranged);
    expect((await loadStorefrontDesign(other.slug)).design.sections).toBeNull();
  });

  it('falls back to Classic when the stored sections break the rules', async () => {
    await prisma.storefrontDesign.update({
      where: { organizationId: shop.id },
      data: { published: design([{ id: 'x', type: 'raw-html', enabled: true }]) },
    });
    const view = await loadStorefrontDesign(shop.slug);
    expect(view.design.look).toBe('classic');
    expect(view.design.sections ?? classicSections()).toEqual(classicSections());
  });
});

describe('what customers say (15.4)', () => {
  it('shows recent published 4- and 5-star reviews of this shop’s products, with the product', async () => {
    const reviews = await getStoreReviews(store());
    expect(reviews.map((r) => [r.rating, r.product.name])).toEqual([[5, 'Adire Dress']]);
    expect(reviews[0]).toMatchObject({ verified: true, title: '5 stars' });
  });

  it('shows nothing for a shop without such reviews', async () => {
    expect(await getStoreReviews({ organizationSlug: `__test-sections-none-${suffix}` })).toEqual([]);
  });
});

describe('brands (15.4)', () => {
  it('shows only brands with something on sale', async () => {
    const brands = await getBrandShowcase(store());
    expect(brands.map((b) => [b.name, b.productCount])).toEqual([['Adire Co', 1]]);
  });
});
