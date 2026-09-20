// Collection and brand actions against the real DB, with a mocked org context.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Collections Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));
vi.mock('@/lib/cloudinary/sign', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cloudinary/sign')>()),
  destroyAsset: vi.fn(async () => {}),
}));

const { createCollection, updateCollection, deleteCollection, getCollection, listCollections, moveCollection, previewCollection, searchCollectionProducts } =
  await import('@/features/inventory/collections');
const { saveBrand, deleteBrand, listBrands } = await import('@/features/inventory/brands');

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

let fashionId = '';
let womenId = '';
const products: Record<string, string> = {};

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Collections Test', slug: `__test-collections-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  ctx.organization.id = org.id;
  ctx.membership.role.permissions = [
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_CREATE,
    PERMISSIONS.INVENTORY_EDIT,
    PERMISSIONS.INVENTORY_CATEGORY_MANAGE,
  ];

  const fashion = await prisma.category.create({ data: { organizationId: org.id, name: 'Fashion', slug: 'fashion' } });
  const women = await prisma.category.create({ data: { organizationId: org.id, name: 'Women', slug: 'women', parentId: fashion.id } });
  fashionId = fashion.id;
  womenId = women.id;

  const make = async (name: string, sku: string, price: number, opts: { categoryId?: string; tags?: string[]; published?: boolean } = {}) => {
    const item = await prisma.inventoryItem.create({
      data: {
        organizationId: org.id,
        name,
        sku,
        slug: sku.toLowerCase(),
        sellingPrice: price,
        categoryId: opts.categoryId,
        tags: opts.tags ?? [],
        isPublished: opts.published ?? false,
      },
    });
    products[sku] = item.id;
  };
  await make('Silk Dress', 'DRESS', 45000, { categoryId: womenId, tags: ['sale'], published: true });
  await make('Denim Skirt', 'SKIRT', 18000, { categoryId: womenId, published: true });
  await make('Travel Mug', 'MUG', 6000, { tags: ['sale'] });
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.collectionItem.deleteMany({ where: { collection: { organizationId } } });
  await prisma.collection.deleteMany({ where: { organizationId } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId } });
  await prisma.category.deleteMany({ where: { organizationId, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: { organizationId } });
  await prisma.brand.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('collections', () => {
  it('creates a hand-picked collection that keeps the chosen order', async () => {
    const { id } = ok(
      await createCollection({
        name: 'Travel Essentials',
        tagline: 'Everything for the trip',
        kind: 'CURATED',
        productIds: [products.MUG, products.DRESS],
      }),
    );
    const detail = ok(await getCollection(id));
    expect(detail.slug).toBe('travel-essentials');
    expect(detail.products.map((p) => p.sku)).toEqual(['MUG', 'DRESS']);
    // one of the two is still a draft
    expect(detail.productCount).toBe(2);
    expect(detail.publishedCount).toBe(1);

    ok(await updateCollection(id, { name: 'Trip Kit', kind: 'CURATED', productIds: [products.DRESS, products.MUG] }));
    const updated = ok(await getCollection(id));
    expect(updated.products.map((p) => p.sku)).toEqual(['DRESS', 'MUG']);
    // renaming keeps the web address customers may have saved
    expect(updated.slug).toBe('travel-essentials');
  });

  it('resolves a rule for an automatic collection, including subcategories', async () => {
    const { id } = ok(
      await createCollection({ name: 'Womens Under 20k', kind: 'DYNAMIC', matchCategoryId: fashionId, matchMaxPrice: 20000 }),
    );
    const detail = ok(await getCollection(id));
    expect(detail.products.map((p) => p.sku)).toEqual(['SKIRT']);

    const preview = ok(await previewCollection({ matchCategoryId: null, matchTag: 'sale', matchMinPrice: null, matchMaxPrice: null, matchCreatedWithinDays: null }));
    expect(preview.products.map((p) => p.sku).sort()).toEqual(['DRESS', 'MUG']);
    expect(preview.publishedCount).toBe(1);
  });

  it('sorts an automatic collection by price', async () => {
    const { id } = ok(await createCollection({ name: 'All Fashion', kind: 'DYNAMIC', matchCategoryId: fashionId, sort: 'PRICE_DESC' }));
    expect(ok(await getCollection(id)).products.map((p) => p.sku)).toEqual(['DRESS', 'SKIRT']);
  });

  it('rejects an empty rule, a bad price range and a duplicate name', async () => {
    expect(await createCollection({ name: 'Empty', kind: 'DYNAMIC' })).toEqual({
      success: false,
      error: expect.stringMatching(/at least one condition/),
    });
    expect(await createCollection({ name: 'Bad range', kind: 'DYNAMIC', matchMinPrice: 5000, matchMaxPrice: 1000 })).toEqual({
      success: false,
      error: expect.stringMatching(/more than the lowest/),
    });
    expect(await createCollection({ name: 'trip kit', kind: 'CURATED' })).toEqual({
      success: false,
      error: expect.stringMatching(/already have a collection/),
    });
  });

  it('drops hand-picked members when a collection becomes automatic', async () => {
    const { id } = ok(await createCollection({ name: 'Switcher', kind: 'CURATED', productIds: [products.MUG] }));
    ok(await updateCollection(id, { name: 'Switcher', kind: 'DYNAMIC', matchTag: 'sale' }));
    expect(await prisma.collectionItem.count({ where: { collectionId: id } })).toBe(0);
    const detail = ok(await getCollection(id));
    expect(detail.matchTag).toBe('sale');
    expect(detail.products.length).toBe(2);
  });

  it('reorders and deletes', async () => {
    const before = ok(await listCollections()).map((c) => c.name);
    const second = ok(await listCollections())[1];
    ok(await moveCollection(second.id, 'up'));
    const after = ok(await listCollections()).map((c) => c.name);
    expect(after[0]).toBe(before[1]);

    ok(await deleteCollection(second.id));
    expect(ok(await listCollections()).some((c) => c.id === second.id)).toBe(false);
  });

  it('excludes products already picked from the search', async () => {
    const results = ok(await searchCollectionProducts('', [products.MUG]));
    expect(results.map((p) => p.sku).sort()).toEqual(['DRESS', 'SKIRT']);
  });

  it('refuses to manage without the permission', async () => {
    const saved = ctx.membership.role.permissions;
    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW];
    try {
      expect(await createCollection({ name: 'Nope', kind: 'CURATED' })).toEqual({
        success: false,
        error: 'You do not have permission to do this',
      });
    } finally {
      ctx.membership.role.permissions = saved;
    }
  });
});

describe('brands', () => {
  it('creates, renames and counts products', async () => {
    const { id } = ok(await saveBrand(null, { name: 'Aurora & Co', description: 'Small-batch basics' }));
    expect(ok(await listBrands())[0]).toMatchObject({ name: 'Aurora & Co', slug: 'aurora-and-co', productCount: 0 });

    await prisma.inventoryItem.update({ where: { id: products.DRESS }, data: { brandId: id } });
    expect(ok(await listBrands())[0]).toMatchObject({ productCount: 1, publishedCount: 1 });

    ok(await saveBrand(id, { name: 'Aurora' }));
    expect(ok(await listBrands())[0].name).toBe('Aurora');
    // the web address doesn't change on rename unless asked
    expect(ok(await listBrands())[0].slug).toBe('aurora-and-co');
  });

  it('rejects a duplicate name and deletes without deleting products', async () => {
    const brands = ok(await listBrands());
    expect(await saveBrand(null, { name: 'aurora' })).toEqual({ success: false, error: expect.stringMatching(/already have a brand/) });

    ok(await deleteBrand(brands[0].id));
    expect(ok(await listBrands())).toHaveLength(0);
    const product = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: products.DRESS } });
    expect(product.brandId).toBeNull();
  });
});
