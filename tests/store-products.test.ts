/*
 * Managing a store's products from the store side (ROADMAP Phase 8.2):
 * who may add what, what an opening quantity actually writes, which
 * overrides belong to the store, and when a product may stop being carried.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Store Products Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { searchStoreCandidates, assignProductsToStore, setStoreStockSettings, removeProductFromStore } = await import(
  '@/features/inventory/store-products'
);
const { getStoreInventory } = await import('@/features/inventory/store-detail');

const ALL = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_EDIT, PERMISSIONS.INVENTORY_MOVEMENT_CREATE];

let lagos = '';
let portHarcourt = '';
let closedStore = '';
let otherStore = '';
let otherOrgId = '';
let otherOrgItem = '';
const items = new Map<string, string>();

async function item(opts: { sku: string; name: string; status?: 'ACTIVE' | 'DISCONTINUED' | 'ARCHIVED'; parentSku?: string }) {
  const created = await prisma.inventoryItem.create({
    data: {
      organizationId: ctx.organization.id,
      sku: opts.sku,
      name: opts.name,
      status: opts.status ?? 'ACTIVE',
      ...(opts.parentSku ? { parentItemId: items.get(opts.parentSku), itemType: 'VARIANT', variantAttributes: { Colour: 'Red' } } : {}),
    },
  });
  items.set(opts.sku, created.id);
  return created.id;
}

/** This store's row for a SKU, straight from the database. */
function levelOf(sku: string, warehouseId = lagos) {
  return prisma.inventoryLevel.findUnique({
    where: { inventoryItemId_warehouseId: { inventoryItemId: items.get(sku)!, warehouseId } },
  });
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Store Products Test', slug: `__test-storeprod-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;

  lagos = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos' } })).id;
  portHarcourt = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Port Harcourt' } })).id;
  closedStore = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Old shop', status: 'INACTIVE' } })).id;

  const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-storeprod-other-${stamp}` } });
  otherOrgId = other.id;
  otherStore = (await prisma.warehouse.create({ data: { organizationId: other.id, name: 'Somebody else' } })).id;
  otherOrgItem = (await prisma.inventoryItem.create({ data: { organizationId: other.id, sku: 'THEIRS', name: 'Their product' } })).id;

  await item({ sku: 'AIRMAX', name: 'Nike Air Max' });
  await item({ sku: 'A15', name: 'Samsung A15' });
  await item({ sku: 'MUG', name: 'Enamel Mug' });
  await item({ sku: 'KETTLE', name: 'Kettle' });
  await item({ sku: 'OLD', name: 'Discontinued thing', status: 'ARCHIVED' });
  // A product with options: the parent is never stocked, its variant is.
  await item({ sku: 'CAP', name: 'Snapback' });
  await item({ sku: 'CAP-RED', name: 'Snapback Red', parentSku: 'CAP' });

  // Already carried in Port Harcourt, so the pickers can say so.
  await prisma.inventoryLevel.create({
    data: { inventoryItemId: items.get('AIRMAX')!, warehouseId: portHarcourt, quantity: 9, reservedQty: 2 },
  });
});

// Every test starts from "Lagos carries nothing" with every permission, so
// one test's additions can't decide what another one sees.
beforeEach(async () => {
  ctx.membership.role.permissions = [...ALL];
  await prisma.stockMovement.deleteMany({ where: { organizationId: ctx.organization.id, warehouseId: lagos } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouseId: lagos } });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.stockMovement.deleteMany({ where: { organizationId } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId, parentItemId: { not: null } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('searchStoreCandidates', () => {
  it('offers what this store does not carry, by name or SKU', async () => {
    const byName = await searchStoreCandidates({ warehouseId: lagos, q: 'Air Max' });
    const bySku = await searchStoreCandidates({ warehouseId: lagos, q: 'A15' });
    if (!byName.success || !bySku.success) throw new Error('expected both searches');

    expect(byName.data.map((r) => r.sku)).toEqual(['AIRMAX']);
    expect(bySku.data.map((r) => r.sku)).toEqual(['A15']);
    // Stock elsewhere is available (9) minus what is held there (2).
    expect(byName.data[0]).toMatchObject({ availableElsewhere: 7, otherStoreCount: 1 });
  });

  it('leaves out archived products, and a parent that is stocked by its options', async () => {
    const all = await searchStoreCandidates({ warehouseId: lagos });
    if (!all.success) throw new Error(all.error);

    const skus = all.data.map((r) => r.sku);
    expect(skus).not.toContain('OLD');
    expect(skus).not.toContain('CAP');
    expect(skus).toContain('CAP-RED');
    const variant = all.data.find((r) => r.sku === 'CAP-RED')!;
    expect(variant.name).toBe('Snapback'); // shown under its product
    expect(variant.variantName).toBe('Red');
  });

  it('stops offering a product once this store carries it', async () => {
    const added = await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('MUG')! }] });
    expect(added.success).toBe(true);

    const result = await searchStoreCandidates({ warehouseId: lagos, q: 'Mug' });
    if (!result.success) throw new Error(result.error);
    expect(result.data).toEqual([]);
  });

  it('cannot search another workspace’s store', async () => {
    const result = await searchStoreCandidates({ warehouseId: otherStore });
    expect(result).toEqual({ success: false, error: 'Store not found' });
  });
});

describe('assignProductsToStore', () => {
  it('adds a product with no stock as an empty row, and it shows in the store’s list', async () => {
    const result = await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('KETTLE')! }] });
    if (!result.success) throw new Error(result.error);
    expect(result.data).toEqual({ added: 1, withOpeningStock: 0, alreadyStocked: 0 });

    const level = await levelOf('KETTLE');
    expect(Number(level!.quantity)).toBe(0);

    const listed = await getStoreInventory({ warehouseId: lagos, perPage: 50 });
    if (!listed.success) throw new Error(listed.error);
    expect(listed.data.rows.map((r) => r.sku)).toEqual(['KETTLE']);
    expect(listed.data.rows[0].stockState).toBe('out');
  });

  it('records an opening quantity through the ledger, with its cost', async () => {
    const result = await assignProductsToStore({
      warehouseId: lagos,
      lines: [{ inventoryItemId: items.get('AIRMAX')!, quantity: 6, unitCost: 21000 }],
    });
    if (!result.success) throw new Error(result.error);
    expect(result.data).toMatchObject({ added: 1, withOpeningStock: 1 });

    const level = await levelOf('AIRMAX');
    expect(Number(level!.quantity)).toBe(6);

    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: ctx.organization.id, warehouseId: lagos, inventoryItemId: items.get('AIRMAX')! },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('IN');
    expect(Number(movements[0].quantity)).toBe(6);
    expect(Number(movements[0].unitCost)).toBe(21000);
  });

  it('skips a product it already carries instead of resetting its quantity', async () => {
    await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('AIRMAX')!, quantity: 6 }] });

    const again = await assignProductsToStore({
      warehouseId: lagos,
      lines: [
        { inventoryItemId: items.get('AIRMAX')!, quantity: 99 },
        { inventoryItemId: items.get('MUG')! },
      ],
    });
    if (!again.success) throw new Error(again.error);
    expect(again.data).toEqual({ added: 1, withOpeningStock: 0, alreadyStocked: 1 });

    const level = await levelOf('AIRMAX');
    expect(Number(level!.quantity)).toBe(6); // untouched
  });

  it('needs permission to record stock before it will take a quantity', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_EDIT];

    const withStock = await assignProductsToStore({
      warehouseId: lagos,
      lines: [{ inventoryItemId: items.get('MUG')!, quantity: 3 }],
    });
    expect(withStock.success).toBe(false);
    expect(await levelOf('MUG')).toBeNull(); // nothing at all was written

    // Without a quantity, the same member may still say what the store carries.
    const withoutStock = await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('MUG')! }] });
    expect(withoutStock.success).toBe(true);
    expect(Number((await levelOf('MUG'))!.quantity)).toBe(0);
  });

  it('refuses a product with options, and names the reason', async () => {
    const result = await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('CAP')! }] });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error).toContain('options');
  });

  it('refuses a closed store, another workspace’s store, and another workspace’s product', async () => {
    const closed = await assignProductsToStore({ warehouseId: closedStore, lines: [{ inventoryItemId: items.get('MUG')! }] });
    expect(closed.success).toBe(false);

    const foreignStore = await assignProductsToStore({ warehouseId: otherStore, lines: [{ inventoryItemId: items.get('MUG')! }] });
    expect(foreignStore).toEqual({ success: false, error: 'Store not found' });

    const foreignItem = await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: otherOrgItem }] });
    expect(foreignItem.success).toBe(false);
    expect(await prisma.inventoryLevel.count({ where: { inventoryItemId: otherOrgItem } })).toBe(0);
  });
});

describe('setStoreStockSettings', () => {
  it('sets this store’s own reorder point, and clearing it hands the decision back to the product', async () => {
    await prisma.inventoryItem.update({ where: { id: items.get('MUG')! }, data: { reorderPoint: 4 } });
    await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('MUG')!, quantity: 8 }] });

    const saved = await setStoreStockSettings({
      warehouseId: lagos,
      inventoryItemId: items.get('MUG')!,
      reorderPoint: 12,
      reorderQty: 24,
      location: ' Aisle 2 ',
    });
    expect(saved.success).toBe(true);

    let listed = await getStoreInventory({ warehouseId: lagos, perPage: 50 });
    if (!listed.success) throw new Error(listed.error);
    let row = listed.data.rows.find((r) => r.sku === 'MUG')!;
    expect(row).toMatchObject({ reorderPoint: 12, reorderPointSource: 'store', reorderQty: 24, location: 'Aisle 2' });
    expect(row.stockState).toBe('low'); // 8 available against this store's 12

    const cleared = await setStoreStockSettings({
      warehouseId: lagos,
      inventoryItemId: items.get('MUG')!,
      reorderPoint: null,
      reorderQty: null,
      location: null,
    });
    expect(cleared.success).toBe(true);

    listed = await getStoreInventory({ warehouseId: lagos, perPage: 50 });
    if (!listed.success) throw new Error(listed.error);
    row = listed.data.rows.find((r) => r.sku === 'MUG')!;
    expect(row).toMatchObject({ reorderPoint: 4, reorderPointSource: 'product', reorderQty: null, location: null });
    expect(row.stockState).toBe('in'); // 8 available against the product's 4

    await prisma.inventoryItem.update({ where: { id: items.get('MUG')! }, data: { reorderPoint: null } });
  });

  it('refuses a product this store does not carry, or another workspace’s store', async () => {
    const notCarried = await setStoreStockSettings({
      warehouseId: lagos,
      inventoryItemId: items.get('KETTLE')!,
      reorderPoint: 3,
      reorderQty: null,
      location: null,
    });
    expect(notCarried.success).toBe(false);

    await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('KETTLE')! }] });
    const foreign = await setStoreStockSettings({
      warehouseId: otherStore,
      inventoryItemId: items.get('KETTLE')!,
      reorderPoint: 3,
      reorderQty: null,
      location: null,
    });
    expect(foreign.success).toBe(false);
  });
});

describe('removeProductFromStore', () => {
  it('removes a product that never moved here', async () => {
    await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('KETTLE')! }] });

    const result = await removeProductFromStore({ warehouseId: lagos, inventoryItemId: items.get('KETTLE')! });
    expect(result.success).toBe(true);
    expect(await levelOf('KETTLE')).toBeNull();
  });

  it('refuses while stock is on the shelf', async () => {
    await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('AIRMAX')!, quantity: 5 }] });

    const result = await removeProductFromStore({ warehouseId: lagos, inventoryItemId: items.get('AIRMAX')! });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error).toContain('still stock');
    expect(await levelOf('AIRMAX')).not.toBeNull();
  });

  it('refuses while something is held for an order', async () => {
    await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('MUG')! }] });
    await prisma.inventoryLevel.update({
      where: { inventoryItemId_warehouseId: { inventoryItemId: items.get('MUG')!, warehouseId: lagos } },
      data: { reservedQty: 2 },
    });

    const result = await removeProductFromStore({ warehouseId: lagos, inventoryItemId: items.get('MUG')! });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error).toContain('held for an order');
  });

  it('keeps an empty row that has history, so the ledger still reads', async () => {
    // Stock arrived and then left: nothing on the shelf, but it happened here.
    await assignProductsToStore({ warehouseId: lagos, lines: [{ inventoryItemId: items.get('A15')!, quantity: 2 }] });
    await prisma.inventoryLevel.update({
      where: { inventoryItemId_warehouseId: { inventoryItemId: items.get('A15')!, warehouseId: lagos } },
      data: { quantity: 0 },
    });

    const result = await removeProductFromStore({ warehouseId: lagos, inventoryItemId: items.get('A15')! });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a refusal');
    expect(result.error).toContain('moved through this store');
    expect(await levelOf('A15')).not.toBeNull();
  });

  it('cannot reach another workspace’s store', async () => {
    const result = await removeProductFromStore({ warehouseId: otherStore, inventoryItemId: items.get('MUG')! });
    expect(result.success).toBe(false);
  });
});
