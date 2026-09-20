// Product server actions against the real DB with a mocked org context and a
// throwaway org. Cloudinary deletes are stubbed; image ownership checks run for real.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Products Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));
vi.mock('@/lib/cloudinary/sign', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cloudinary/sign')>()),
  destroyAsset: vi.fn(async () => {}),
}));

const { createProduct, updateProduct, getProduct, listProducts, setProductPublished } = await import('@/features/inventory/products');
const { listStockableItems } = await import('@/features/inventory/items');

const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const image = (name: string) => ({
  url: `https://res.cloudinary.com/${cloud}/image/upload/v1/mansaas/${ctx.organization.id}/products/${name}.jpg`,
  publicId: `mansaas/${ctx.organization.id}/products/${name}`,
});

let onlineStore = '';
let backroom = '';

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Products Test', slug: `__test-products-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  ctx.organization.id = org.id;
  ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CREATE, PERMISSIONS.INVENTORY_EDIT];
  onlineStore = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos', sellsOnline: true } })).id;
  backroom = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Backroom' } })).id;
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.stockMovement.deleteMany({ where: { organizationId } });
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
});

const tee = {
  name: 'Classic Tee',
  sku: 'TEE',
  sellingPrice: 8000,
  options: [
    { name: 'Colour', kind: 'color' as const, values: [{ label: 'Red', swatch: '#cc0000' }, { label: 'Navy' }] },
    { name: 'Size', kind: 'size' as const, values: [{ label: 'M' }, { label: 'L' }] },
  ],
};
const teeVariants = [
  { sku: 'TEE-RED-M', attributes: { Colour: 'Red', Size: 'M' } },
  { sku: 'TEE-RED-L', attributes: { Colour: 'Red', Size: 'L' }, sellingPrice: 9000 },
  { sku: 'TEE-NAVY-M', attributes: { Colour: 'Navy', Size: 'M' } },
];

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe('products', () => {
  it('creates a simple product with a generated web address and rejects a duplicate SKU', async () => {
    const { id } = ok(await createProduct({ name: 'Canvas Tote Bag', sku: 'TOTE-1', sellingPrice: 5000 }));
    const product = ok(await getProduct(id));
    expect(product.slug).toBe('canvas-tote-bag');
    expect(product.isPublished).toBe(false);

    const dup = await createProduct({ name: 'Another', sku: 'tote-1' });
    expect(dup).toEqual({ success: false, error: expect.stringMatching(/TOTE-1.*already used/) });
  });

  it('refuses to publish without a price and an image, and accepts once they exist', async () => {
    const blocked = await createProduct({ name: 'Mug', sku: 'MUG', isPublished: true });
    expect(blocked).toEqual({ success: false, error: expect.stringMatching(/selling price.*image/) });

    const { id } = ok(await createProduct({ name: 'Mug', sku: 'MUG', sellingPrice: 3000, images: [image('mug')], isPublished: true }));
    const product = ok(await getProduct(id));
    expect(product.isPublished).toBe(true);
    expect(product.publishedAt).not.toBeNull();
  });

  it('rejects images from another workspace and fake discounts', async () => {
    const foreign = await createProduct({
      name: 'Hat',
      sku: 'HAT',
      images: [{ url: `https://res.cloudinary.com/${cloud}/image/upload/v1/mansaas/someone-else/products/x.jpg`, publicId: 'mansaas/someone-else/products/x' }],
    });
    expect(foreign.success).toBe(false);

    const fake = await createProduct({ name: 'Hat', sku: 'HAT', sellingPrice: 5000, compareAtPrice: 4000 });
    expect(fake).toEqual({ success: false, error: expect.stringMatching(/higher than the selling price/) });
  });

  it('creates variants with their own prices and images; only variants are stockable', async () => {
    const red = image('tee-red');
    const { id } = ok(
      await createProduct({
        ...tee,
        images: [red, image('tee-navy')],
        variants: teeVariants.map((v) => ({ ...v, imageUrl: v.attributes.Colour === 'Red' ? red.url : null })),
      }),
    );
    const product = ok(await getProduct(id));
    expect(product.variants).toHaveLength(3);
    expect(product.variants.find((v) => v.sku === 'TEE-RED-L')).toMatchObject({ sellingPrice: 9000, imageUrl: red.url });
    expect(product.options[0].values[0]).toEqual({ label: 'Red', swatch: '#cc0000' });

    const stockable = ok(await listStockableItems());
    const skus = stockable.map((i) => i.sku);
    expect(skus).toEqual(expect.arrayContaining(['TEE-RED-M', 'TEE-RED-L', 'TEE-NAVY-M']));
    expect(skus).not.toContain('TEE');
    // variants without their own price inherit the product's
    expect(stockable.find((i) => i.sku === 'TEE-RED-M')?.sellingPrice).toBe(8000);
    expect(stockable.find((i) => i.sku === 'TEE-RED-M')?.name).toBe('Classic Tee (Red / M)');
  });

  it('deletes unused removed variants, archives used ones, and revives an archived one when re-added', async () => {
    const list = ok(await listProducts({ q: 'Classic Tee' }));
    const productId = list.rows[0].id;
    const before = ok(await getProduct(productId));
    const redM = before.variants.find((v) => v.sku === 'TEE-RED-M')!;
    const navyM = before.variants.find((v) => v.sku === 'TEE-NAVY-M')!;

    // Red/M has history
    await prisma.stockMovement.create({
      data: { organizationId: ctx.organization.id, inventoryItemId: redM.id, warehouseId: onlineStore, type: 'IN', quantity: 5 },
    });
    await prisma.inventoryLevel.create({ data: { inventoryItemId: redM.id, warehouseId: onlineStore, quantity: 5 } });

    const payload = (variants: typeof before.variants) => ({
      ...tee,
      images: before.images.map(({ id: _id, ...i }) => i),
      variants: variants.map((v) => ({ id: v.id, sku: v.sku, attributes: v.attributes, sellingPrice: v.sellingPrice, imageUrl: v.imageUrl })),
    });

    ok(await updateProduct(productId, payload(before.variants.filter((v) => v.id !== redM.id && v.id !== navyM.id))));
    const after = await prisma.inventoryItem.findMany({ where: { parentItemId: productId } });
    expect(after.find((v) => v.id === navyM.id)).toBeUndefined();
    expect(after.find((v) => v.id === redM.id)?.status).toBe('ARCHIVED');

    // re-add Red / M without an id → same row, active again
    const current = ok(await getProduct(productId)).variants.filter((v) => v.status !== 'ARCHIVED');
    ok(
      await updateProduct(productId, {
        ...payload(current),
        variants: [...payload(current).variants, { sku: 'TEE-RED-M', attributes: { Colour: 'Red', Size: 'M' } }],
      }),
    );
    const revived = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: redM.id } });
    expect(revived.status).toBe('ACTIVE');
  });

  it('won’t split a product that already holds stock into variants', async () => {
    const { id } = ok(await createProduct({ name: 'Socks', sku: 'SOCK', sellingPrice: 1500 }));
    await prisma.inventoryLevel.create({ data: { inventoryItemId: id, warehouseId: backroom, quantity: 10 } });
    const result = await updateProduct(id, {
      name: 'Socks',
      sku: 'SOCK',
      options: [{ name: 'Size', kind: 'size', values: [{ label: 'M' }] }],
      variants: [{ sku: 'SOCK-M', attributes: { Size: 'M' } }],
    });
    expect(result).toEqual({ success: false, error: expect.stringMatching(/can’t be split into variants/) });
  });

  it('lists with category-subtree filter, stock states and online-only stock', async () => {
    const root = await prisma.category.create({ data: { organizationId: ctx.organization.id, name: 'Kitchen', slug: 'kitchen' } });
    const child = await prisma.category.create({ data: { organizationId: ctx.organization.id, name: 'Cups', slug: 'cups', parentId: root.id } });
    const { id } = ok(await createProduct({ name: 'Espresso Cup', sku: 'CUP', sellingPrice: 2000, categoryId: child.id, reorderPoint: 5 }));
    await prisma.inventoryLevel.create({ data: { inventoryItemId: id, warehouseId: onlineStore, quantity: 3 } });
    await prisma.inventoryLevel.create({ data: { inventoryItemId: id, warehouseId: backroom, quantity: 1 } });

    const result = ok(await listProducts({ categoryId: root.id }));
    expect(result.rows.map((r) => r.sku)).toEqual(['CUP']);
    expect(result.rows[0]).toMatchObject({ available: 4, onlineAvailable: 3, stockState: 'low', categoryPath: ['Kitchen', 'Cups'] });

    const out = ok(await listProducts({ stock: 'out' }));
    expect(out.rows.map((r) => r.sku)).toContain('TOTE-1');
    expect(out.rows.map((r) => r.sku)).not.toContain('CUP');
  });

  it('quick-publishes through the same checks', async () => {
    const list = ok(await listProducts({ q: 'Canvas Tote' }));
    const result = await setProductPublished(list.rows[0].id, true);
    expect(result).toEqual({ success: false, error: expect.stringMatching(/image/) });
  });
});
