/*
 * Importing products from a spreadsheet (ROADMAP 14.2), against the real
 * database with a mocked org context and a throwaway workspace.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Import Test', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', warehouseIds: [] as string[], role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { previewProductImport, importProducts } = await import('@/features/inventory/product-import');

const ALL = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CREATE, PERMISSIONS.INVENTORY_EDIT, PERMISSIONS.INVENTORY_MOVEMENT_CREATE];
let mainShop = '';
let ikeja = '';

const FILE = [
  'Name,SKU,Option 1 name,Option 1 value,Price,Cost price,Category,Brand,Stock: Main shop,Stock: ikeja',
  'Ceramic mug,MUG-1,,,2500,1200,Kitchen,Acme,10,',
  'Linen shirt,LS-M,Size,M,12000,,Women > Tops,,4,2',
  'Linen shirt,LS-L,Size,L,12500,,,,6,',
  'Straw hat,HAT-1,,,oops,,Nowhere,Nobody,,',
  'Tote bag,TOTE-1,,,7000,,Nowhere,Nobody,,',
].join('\n');

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Import Test', slug: `__test-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = ALL;
  mainShop = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Main shop' } })).id;
  ikeja = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Ikeja' } })).id;
  await prisma.category.create({ data: { organizationId: org.id, name: 'Kitchen', slug: 'kitchen' } });
  const women = await prisma.category.create({ data: { organizationId: org.id, name: 'Women', slug: 'women' } });
  await prisma.category.create({ data: { organizationId: org.id, name: 'Tops', slug: 'tops', parentId: women.id } });
  await prisma.brand.create({ data: { organizationId: org.id, name: 'Acme', slug: 'acme' } });
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.stockMovement.deleteMany({ where: { organizationId } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId, parentItemId: { not: null } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId } });
  await prisma.category.deleteMany({ where: { organizationId, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: { organizationId } });
  await prisma.brand.deleteMany({ where: { organizationId } });
  await prisma.warehouse.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('preview', () => {
  it('says what will happen, per product, and writes nothing', async () => {
    const result = await previewProductImport(FILE);
    if (!result.success) throw new Error(result.error);
    const p = result.data;
    expect(p.fileErrors).toEqual([]);
    expect(p.summary).toEqual({ rows: 5, ready: 3, skipped: 1, variants: 2, stockLines: 4 });

    const byName = Object.fromEntries(p.products.map((x) => [x.name, x]));
    expect(byName['Ceramic mug']).toMatchObject({ ready: true, sku: 'MUG-1', category: 'Kitchen', stockTotal: 10 });
    expect(byName['Linen shirt']).toMatchObject({
      ready: true,
      sku: 'LINEN-SHIRT',
      variantCount: 2,
      priceMin: 12000,
      priceMax: 12500,
      category: 'Women > Tops',
      stockTotal: 12,
    });
    expect(byName['Straw hat']).toMatchObject({ ready: false });
    expect(byName['Tote bag'].warnings).toEqual([
      'There’s no category “Nowhere” — it will be imported without one.',
      'There’s no brand “Nobody” — it will be imported without one.',
    ]);
    expect(await prisma.inventoryItem.count({ where: { organizationId: ctx.organization.id } })).toBe(0);
  });

  it('stops the whole file for an unknown store, stock you may not record, or a store you can’t use', async () => {
    const unknown = await previewProductImport('Name,SKU,Stock: Lekki\nMug,M1,3\n');
    expect(unknown.success && unknown.data.fileErrors[0]).toMatch(/no store called “Lekki”/);

    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_CREATE];
    const noStock = await previewProductImport(FILE);
    expect(noStock.success && noStock.data.fileErrors).toEqual([expect.stringMatching(/not record stock/)]);
    expect(await importProducts(FILE)).toMatchObject({ success: false });

    ctx.membership.role.permissions = ALL;
    ctx.membership.warehouseIds = [mainShop];
    const scoped = await previewProductImport(FILE);
    expect(scoped.success && scoped.data.fileErrors).toEqual([expect.stringMatching(/can’t record stock at Ikeja/)]);
    ctx.membership.warehouseIds = [];

    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW];
    expect(await previewProductImport(FILE)).toMatchObject({ success: false, error: expect.stringMatching(/permission/) });
    ctx.membership.role.permissions = ALL;
  });
});

describe('import', () => {
  it('creates the ready products as drafts, with variants, and records opening stock in the ledger', async () => {
    const result = await importProducts(FILE);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toEqual({ created: 3, stockLines: 4, skipped: 1, failures: [] });

    const organizationId = ctx.organization.id;
    const shirt = await prisma.inventoryItem.findFirstOrThrow({
      where: { organizationId, sku: 'LINEN-SHIRT' },
      include: { variants: { orderBy: { sku: 'asc' } }, category: true },
    });
    expect(shirt).toMatchObject({ isPublished: false, name: 'Linen shirt' });
    expect(shirt.category?.name).toBe('Tops');
    expect(shirt.variants.map((v) => [v.sku, Number(v.sellingPrice)])).toEqual([
      ['LS-L', 12500],
      ['LS-M', 12000],
    ]);

    const mug = await prisma.inventoryItem.findFirstOrThrow({ where: { organizationId, sku: 'MUG-1' }, include: { brand: true } });
    expect(mug.brand?.name).toBe('Acme');
    const level = await prisma.inventoryLevel.findUniqueOrThrow({
      where: { inventoryItemId_warehouseId: { inventoryItemId: mug.id, warehouseId: mainShop } },
    });
    expect(Number(level.quantity)).toBe(10);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { inventoryItemId: mug.id } });
    expect(movement).toMatchObject({ type: 'IN', warehouseId: mainShop, notes: 'Opening stock (imported from a spreadsheet)' });
    expect(Number(movement.unitCost)).toBe(1200);

    const m = shirt.variants.find((v) => v.sku === 'LS-M')!;
    const levels = await prisma.inventoryLevel.findMany({ where: { inventoryItemId: m.id } });
    expect(Object.fromEntries(levels.map((l) => [l.warehouseId, Number(l.quantity)]))).toEqual({ [mainShop]: 4, [ikeja]: 2 });

    expect(await prisma.inventoryItem.count({ where: { organizationId, sku: 'HAT-1' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId, action: 'inventory.item.imported' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId, action: 'inventory.item.created' } })).toBe(3);
  }, 120_000);

  it('skips products whose SKUs are already in use, rather than changing them', async () => {
    const again = await previewProductImport(FILE);
    if (!again.success) throw new Error(again.error);
    expect(again.data.summary.ready).toBe(0);
    expect(again.data.products.find((p) => p.name === 'Ceramic mug')!.errors[0]).toMatch(/already used by a product/);
    expect(await importProducts(FILE)).toMatchObject({ success: false, error: expect.stringMatching(/nothing in this file/) });
  });
});
