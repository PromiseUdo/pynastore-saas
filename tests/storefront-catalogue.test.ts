/*
 * The storefront catalogue built from a merchant's real records.
 *
 * This is the boundary between "what the shop keeps" and "what a shopper is
 * allowed to see", so the cases below are mostly about what must NOT cross
 * it: drafts, archived rows, hidden categories, stock sitting in a store
 * that doesn't sell online, and another tenant's products.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { loadCatalogueFromDb } from '@/lib/storefront/data/from-prisma';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slugA = `__test-store-a-${suffix}`;
const slugB = `__test-store-b-${suffix}`;

const ids: Record<string, string> = {};

async function makeOrg(slug: string) {
  return prisma.organization.create({ data: { name: slug, slug } });
}

beforeAll(async () => {
  const orgA = await makeOrg(slugA);
  const orgB = await makeOrg(slugB);
  ids.orgA = orgA.id;
  ids.orgB = orgB.id;

  // Stores: one sells online, one is stockroom only, one is inactive.
  const online = await prisma.warehouse.create({ data: { organizationId: orgA.id, name: 'Lagos', sellsOnline: true } });
  const backroom = await prisma.warehouse.create({ data: { organizationId: orgA.id, name: 'Backroom' } });
  const closed = await prisma.warehouse.create({
    data: { organizationId: orgA.id, name: 'Closed', sellsOnline: true, status: 'INACTIVE' },
  });
  Object.assign(ids, { online: online.id, backroom: backroom.id, closed: closed.id });

  const fashion = await prisma.category.create({ data: { organizationId: orgA.id, name: 'Fashion', slug: 'fashion', isFeatured: true } });
  const women = await prisma.category.create({ data: { organizationId: orgA.id, name: 'Women', slug: 'women', parentId: fashion.id } });
  const secret = await prisma.category.create({ data: { organizationId: orgA.id, name: 'Clearance', slug: 'clearance', isVisible: false } });
  const secretChild = await prisma.category.create({
    data: { organizationId: orgA.id, name: 'Old stock', slug: 'old-stock', parentId: secret.id },
  });
  Object.assign(ids, { fashion: fashion.id, women: women.id, secret: secret.id, secretChild: secretChild.id });

  const brand = await prisma.brand.create({ data: { organizationId: orgA.id, name: 'Aurora', slug: 'aurora' } });
  const unusedBrand = await prisma.brand.create({ data: { organizationId: orgA.id, name: 'Nobody', slug: 'nobody' } });
  Object.assign(ids, { brand: brand.id, unusedBrand: unusedBrand.id });

  // A published product with two variants, one image, and stock in three stores.
  const tee = await prisma.inventoryItem.create({
    data: {
      organizationId: orgA.id,
      name: 'Classic Tee',
      sku: 'TEE',
      slug: 'classic-tee',
      sellingPrice: 8500,
      compareAtPrice: 10000,
      categoryId: women.id,
      brandId: brand.id,
      isPublished: true,
      tags: ['new', 'sale', 'not-a-real-tag'],
      highlights: ['100% cotton'],
      specs: [{ label: 'Material', value: 'Cotton' }],
      variantOptions: [{ name: 'Colour', kind: 'color', values: [{ label: 'Red', swatch: '#cc0000' }, { label: 'Navy' }] }],
    },
  });
  const image = await prisma.productImage.create({
    data: { organizationId: orgA.id, inventoryItemId: tee.id, url: 'https://res.cloudinary.com/x/image/upload/v1/tee.jpg', alt: 'Tee' },
  });
  const red = await prisma.inventoryItem.create({
    data: {
      organizationId: orgA.id,
      name: 'Classic Tee (Red)',
      sku: 'TEE-RED',
      itemType: 'VARIANT',
      parentItemId: tee.id,
      variantAttributes: { Colour: 'Red' },
      sellingPrice: 9000,
      imageId: image.id,
    },
  });
  const navy = await prisma.inventoryItem.create({
    data: {
      organizationId: orgA.id,
      name: 'Classic Tee (Navy)',
      sku: 'TEE-NAVY',
      itemType: 'VARIANT',
      parentItemId: tee.id,
      variantAttributes: { Colour: 'Navy' },
    },
  });
  // An archived variant must never be offered.
  await prisma.inventoryItem.create({
    data: {
      organizationId: orgA.id,
      name: 'Classic Tee (Olive)',
      sku: 'TEE-OLIVE',
      itemType: 'VARIANT',
      parentItemId: tee.id,
      variantAttributes: { Colour: 'Olive' },
      status: 'ARCHIVED',
    },
  });
  Object.assign(ids, { tee: tee.id, red: red.id, navy: navy.id, image: image.id });

  await prisma.inventoryLevel.createMany({
    data: [
      { inventoryItemId: red.id, warehouseId: online.id, quantity: 10, reservedQty: 3 }, // 7 sellable
      { inventoryItemId: red.id, warehouseId: backroom.id, quantity: 50 }, // not sold online
      { inventoryItemId: navy.id, warehouseId: closed.id, quantity: 20 }, // store is inactive
    ],
  });

  // A simple published product, stocked online.
  const mug = await prisma.inventoryItem.create({
    data: {
      organizationId: orgA.id,
      name: 'Travel Mug',
      sku: 'MUG',
      slug: 'travel-mug',
      sellingPrice: 6000,
      categoryId: fashion.id,
      isPublished: true,
    },
  });
  await prisma.productImage.create({
    data: { organizationId: orgA.id, inventoryItemId: mug.id, url: 'https://res.cloudinary.com/x/image/upload/v1/mug.jpg' },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: mug.id, warehouseId: online.id, quantity: 4 } });
  ids.mug = mug.id;

  // Must not appear: a draft, an archived product, and one filed in a hidden category.
  await prisma.inventoryItem.create({
    data: { organizationId: orgA.id, name: 'Draft', sku: 'DRAFT', slug: 'draft', sellingPrice: 100, isPublished: false },
  });
  await prisma.inventoryItem.create({
    data: { organizationId: orgA.id, name: 'Archived', sku: 'ARCH', slug: 'arch', sellingPrice: 100, isPublished: true, status: 'ARCHIVED' },
  });
  const hidden = await prisma.inventoryItem.create({
    data: {
      organizationId: orgA.id,
      name: 'Hidden category item',
      sku: 'HID',
      slug: 'hidden-item',
      sellingPrice: 2000,
      categoryId: secretChild.id,
      isPublished: true,
    },
  });
  ids.hidden = hidden.id;

  // Collections: one hand-picked (including a draft that must be dropped), one rule-based, one hidden.
  const curated = await prisma.collection.create({
    data: {
      organizationId: orgA.id,
      name: 'Staff picks',
      slug: 'staff-picks',
      tagline: 'What we reach for',
      isFeatured: true,
      items: { create: [{ inventoryItemId: mug.id, position: 0 }, { inventoryItemId: tee.id, position: 1 }] },
    },
  });
  const dynamic = await prisma.collection.create({
    data: {
      organizationId: orgA.id,
      name: 'Womens under 10k',
      slug: 'womens-under-10k',
      kind: 'DYNAMIC',
      sort: 'PRICE_ASC',
      matchCategoryId: women.id,
      matchMaxPrice: 10000,
      matchTag: 'sale',
    },
  });
  await prisma.collection.create({
    data: { organizationId: orgA.id, name: 'Hidden', slug: 'hidden-collection', isVisible: false },
  });
  Object.assign(ids, { curated: curated.id, dynamic: dynamic.id });

  // Store B: its own published product, to prove the boundary.
  await prisma.inventoryItem.create({
    data: { organizationId: orgB.id, name: 'Other store item', sku: 'OTHER', slug: 'other-item', sellingPrice: 500, isPublished: true },
  });
});

afterAll(async () => {
  for (const organizationId of [ids.orgA, ids.orgB]) {
    await prisma.collectionItem.deleteMany({ where: { collection: { organizationId } } });
    await prisma.collection.deleteMany({ where: { organizationId } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
    await prisma.inventoryItem.updateMany({ where: { organizationId }, data: { imageId: null } });
    await prisma.productImage.deleteMany({ where: { organizationId } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId, parentItemId: { not: null } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.category.deleteMany({ where: { organizationId, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: { organizationId } });
    await prisma.brand.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('what reaches the storefront', () => {
  it('publishes only published, active products', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    expect(cat.products.map((p) => p.slug).sort()).toEqual(['classic-tee', 'hidden-item', 'travel-mug']);
    expect(cat.storeName).toBe(slugA);
  });

  it('sells only stock in stores that sell online, minus what orders reserve', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    const tee = cat.productBySlug.get('classic-tee')!;
    const red = tee.variants.find((v) => v.sku === 'TEE-RED')!;
    const navy = tee.variants.find((v) => v.sku === 'TEE-NAVY')!;

    expect(red.stock).toBe(7); // 10 on hand − 3 reserved; the 50 in the backroom don't count
    expect(navy.stock).toBe(0); // its only stock sits in an inactive store
    expect(tee.inStock).toBe(true);
    expect(cat.productBySlug.get('travel-mug')!.variants[0].stock).toBe(4);
  });

  it('drops archived variants and keeps prices in kobo, inheriting the product price', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    const tee = cat.productBySlug.get('classic-tee')!;

    expect(tee.variants.map((v) => v.sku)).toEqual(['TEE-RED', 'TEE-NAVY']);
    expect(tee.variants.find((v) => v.sku === 'TEE-RED')!.price).toBe(900_000); // ₦9,000 of its own
    expect(tee.variants.find((v) => v.sku === 'TEE-NAVY')!.price).toBe(850_000); // inherits ₦8,500
    expect(tee.priceFrom).toBe(850_000);
    expect(tee.priceTo).toBe(900_000);
    expect(tee.compareAtPrice).toBe(1_000_000);
  });

  it('gives a product without variants one buyable unit, keyed by its own id', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    const mug = cat.productBySlug.get('travel-mug')!;
    expect(mug.variants).toHaveLength(1);
    expect(mug.variants[0].id).toBe(ids.mug);
  });

  it('carries options, swatches, tags and images across', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    const tee = cat.productBySlug.get('classic-tee')!;

    expect(tee.options[0]).toMatchObject({ name: 'Colour', kind: 'color' });
    expect(tee.options[0].values[0]).toMatchObject({ label: 'Red', swatch: '#cc0000' });
    // ids are built from the names, so one colour filters the whole store
    expect(tee.variants[0].optionValueIds).toEqual(['ov_colour_red']);
    // an unknown tag written straight to the row is ignored
    expect(tee.tags.sort()).toEqual(['new', 'sale']);
    expect(tee.images[0]).toMatchObject({ url: expect.stringContaining('tee.jpg'), alt: 'Tee' });
    // the image belongs to the red variant only, so the gallery can follow the choice
    expect(tee.images[0].optionValueId).toBe('ov_colour_red');
    expect(tee.brandName).toBe('Aurora');
    expect(tee.highlights).toEqual(['100% cotton']);
    expect(tee.specs).toEqual([{ label: 'Material', value: 'Cotton' }]);
  });

  it('invents no ratings', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    expect(cat.products.every((p) => p.rating.count === 0 && p.rating.average === 0)).toBe(true);
    expect(cat.hasRatings).toBe(false);
  });

  it('hides a hidden category and everything under it, without hiding its products', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    expect(cat.categories.map((c) => c.slug).sort()).toEqual(['fashion', 'women']);

    const women = cat.categoryBySlug.get('women')!;
    expect(women.path).toEqual(['fashion', 'women']);
    expect(women.level).toBe(1);
    expect(cat.subtreeIds(cat.categoryBySlug.get('fashion')!.id).sort()).toEqual([ids.fashion, ids.women].sort());

    // Still for sale and findable by search — just not filed anywhere browsable.
    const orphan = cat.productBySlug.get('hidden-item')!;
    expect(orphan.categoryIds).toEqual([]);
  });

  it('files a product under every category on its path', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    expect(cat.productBySlug.get('classic-tee')!.categoryIds).toEqual([ids.fashion, ids.women]);
  });

  it('maps collections, dropping hidden ones and unpublished members', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    expect(cat.collections.map((c) => c.slug).sort()).toEqual(['staff-picks', 'womens-under-10k']);

    const curated = cat.collectionBySlug.get('staff-picks')!;
    expect(curated.rule).toEqual({ kind: 'curated', productIds: [ids.mug, ids.tee] });
    expect(curated.featured).toBe(true);
    expect(curated.tagline).toBe('What we reach for');

    const dynamic = cat.collectionBySlug.get('womens-under-10k')!;
    expect(dynamic.sort).toBe('price-asc');
    expect(dynamic.rule).toEqual({
      kind: 'dynamic',
      match: { categoryPath: ['fashion', 'women'], tag: 'sale', maxPrice: 1_000_000 },
    });
  });

  it('offers only brands that have something to sell', async () => {
    const cat = (await loadCatalogueFromDb(slugA))!;
    expect(cat.brands.map((b) => b.slug)).toEqual(['aurora']);
  });

  it('never leaks another store’s catalogue', async () => {
    const a = (await loadCatalogueFromDb(slugA))!;
    const b = (await loadCatalogueFromDb(slugB))!;

    expect(a.products.some((p) => p.slug === 'other-item')).toBe(false);
    expect(b.products.map((p) => p.slug)).toEqual(['other-item']);
    expect(b.categories).toEqual([]);
    expect(b.collections).toEqual([]);
  });

  it('returns null for a store that doesn’t exist', async () => {
    expect(await loadCatalogueFromDb('__no-such-store')).toBeNull();
  });
});
