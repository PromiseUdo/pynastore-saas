// The store page's reads, against the real DB with a mocked org context and a
// throwaway org: what a store holds, how a threshold is chosen, and that one
// workspace can never open another's store.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Stores Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { getStoreDetail, getStoreInventory, getStoreActivity, getStoreOpenTransfers } = await import(
  '@/features/inventory/store-detail'
);

let lagos = '';
let portHarcourt = '';
let otherOrgId = '';
let otherStore = '';
/** ids of the items created here, by SKU */
const items = new Map<string, string>();

async function item(opts: {
  sku: string;
  name: string;
  reorderPoint?: number;
  averageCost?: number;
  parentSku?: string;
  attributes?: Record<string, string>;
}) {
  const created = await prisma.inventoryItem.create({
    data: {
      organizationId: ctx.organization.id,
      sku: opts.sku,
      name: opts.name,
      reorderPoint: opts.reorderPoint,
      averageCost: opts.averageCost ?? 0,
      ...(opts.parentSku
        ? { parentItemId: items.get(opts.parentSku), itemType: 'VARIANT', variantAttributes: opts.attributes ?? {} }
        : {}),
    },
  });
  items.set(opts.sku, created.id);
  return created.id;
}

async function level(opts: {
  sku: string;
  warehouseId: string;
  quantity: number;
  reservedQty?: number;
  reorderPoint?: number;
  location?: string;
}) {
  await prisma.inventoryLevel.create({
    data: {
      inventoryItemId: items.get(opts.sku)!,
      warehouseId: opts.warehouseId,
      quantity: opts.quantity,
      reservedQty: opts.reservedQty ?? 0,
      reorderPoint: opts.reorderPoint,
      location: opts.location,
    },
  });
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Stores Test', slug: `__test-stores-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_EDIT];

  lagos = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos', sellsOnline: true, location: 'Ikoyi' } })).id;
  portHarcourt = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Port Harcourt' } })).id;

  const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-stores-other-${stamp}` } });
  otherOrgId = other.id;
  otherStore = (await prisma.warehouse.create({ data: { organizationId: other.id, name: 'Somebody else' } })).id;

  // In stock at Lagos, and low at Port Harcourt on the product's own threshold.
  await item({ sku: 'AIRMAX', name: 'Nike Air Max', reorderPoint: 5, averageCost: 20000 });
  await level({ sku: 'AIRMAX', warehouseId: lagos, quantity: 10, location: 'Aisle 4' });
  await level({ sku: 'AIRMAX', warehouseId: portHarcourt, quantity: 3 });

  // Low at Lagos only because Lagos sets a higher threshold of its own.
  await item({ sku: 'A15', name: 'Samsung A15', reorderPoint: 2, averageCost: 150000 });
  await level({ sku: 'A15', warehouseId: lagos, quantity: 7, reorderPoint: 10 });

  // Nothing left at Lagos.
  await item({ sku: 'TEE', name: 'Plain Tee', averageCost: 3000 });
  await level({ sku: 'TEE', warehouseId: lagos, quantity: 0 });

  // Everything on the shelf is already promised to orders.
  await item({ sku: 'MUG', name: 'Enamel Mug', averageCost: 2500 });
  await level({ sku: 'MUG', warehouseId: lagos, quantity: 4, reservedQty: 4 });

  // A variant carries its own level; the row names the parent product.
  await item({ sku: 'CAP', name: 'Snapback', averageCost: 5000 });
  await item({ sku: 'CAP-RED', name: 'Snapback Red', parentSku: 'CAP', averageCost: 5000, attributes: { Colour: 'Red' } });
  await level({ sku: 'CAP-RED', warehouseId: lagos, quantity: 6 });

  // Archived products are not this store's business.
  const archived = await prisma.inventoryItem.create({
    data: { organizationId: org.id, sku: 'OLD', name: 'Discontinued thing', status: 'ARCHIVED', averageCost: 1000 },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: archived.id, warehouseId: lagos, quantity: 99 } });

  await prisma.stockTransfer.create({
    data: {
      organizationId: org.id,
      inventoryItemId: items.get('AIRMAX')!,
      fromWarehouseId: portHarcourt,
      toWarehouseId: lagos,
      quantity: 4,
      status: 'DISPATCHED',
    },
  });
  await prisma.stockTransfer.create({
    data: {
      organizationId: org.id,
      inventoryItemId: items.get('TEE')!,
      fromWarehouseId: lagos,
      toWarehouseId: portHarcourt,
      quantity: 2,
      status: 'RECEIVED',
      receivedAt: new Date(),
    },
  });

  await prisma.stockMovement.create({
    data: {
      organizationId: org.id,
      inventoryItemId: items.get('AIRMAX')!,
      warehouseId: lagos,
      type: 'IN',
      quantity: 10,
      referenceType: 'PurchaseOrder',
    },
  });
  // Sent FROM Port Harcourt TO Lagos: Lagos's news as much as Port Harcourt's.
  await prisma.stockMovement.create({
    data: {
      organizationId: org.id,
      inventoryItemId: items.get('AIRMAX')!,
      warehouseId: portHarcourt,
      toWarehouseId: lagos,
      type: 'TRANSFER',
      quantity: 4,
    },
  });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.stockMovement.deleteMany({ where: { organizationId } });
    await prisma.stockTransfer.deleteMany({ where: { organizationId } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId, parentItemId: { not: null } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('getStoreDetail', () => {
  it('counts what this store holds, and nothing another store holds', async () => {
    const result = await getStoreDetail(lagos);
    if (!result.success) throw new Error(result.error);

    expect(result.data.name).toBe('Lagos');
    expect(result.data.sellsOnline).toBe(true);
    // AIRMAX, A15, TEE, MUG, CAP-RED — the archived item is left out.
    expect(result.data.productCount).toBe(5);
    expect(result.data.unitsOnHand).toBe(10 + 7 + 0 + 4 + 6);
    expect(result.data.unitsHeld).toBe(4);
    expect(result.data.stockValue).toBe(10 * 20000 + 7 * 150000 + 4 * 2500 + 6 * 5000);
  });

  it('uses the store’s own reorder point when it has one, and the product’s otherwise', async () => {
    const lagosResult = await getStoreDetail(lagos);
    const phResult = await getStoreDetail(portHarcourt);
    if (!lagosResult.success || !phResult.success) throw new Error('expected both stores');

    // Lagos: A15 is low on its own threshold of 10; TEE and MUG have nothing available.
    expect(lagosResult.data.lowStockCount).toBe(1);
    expect(lagosResult.data.outOfStockCount).toBe(2);
    // Port Harcourt: AIRMAX at 3 is under the product's threshold of 5.
    expect(phResult.data.lowStockCount).toBe(1);
    expect(phResult.data.outOfStockCount).toBe(0);
  });

  it('counts only transfers still on their way, in the right direction', async () => {
    const result = await getStoreDetail(lagos);
    if (!result.success) throw new Error(result.error);
    expect(result.data.transfersIncoming).toBe(1);
    expect(result.data.transfersOutgoing).toBe(0); // the one Lagos sent was received
  });

  it('cannot open another workspace’s store', async () => {
    const result = await getStoreDetail(otherStore);
    expect(result).toEqual({ success: false, error: 'Store not found' });
  });

  it('needs permission to see stock', async () => {
    const granted = ctx.membership.role.permissions;
    ctx.membership.role.permissions = [];
    const result = await getStoreDetail(lagos);
    ctx.membership.role.permissions = granted;
    expect(result.success).toBe(false);
  });
});

describe('getStoreInventory', () => {
  it('lists this store’s stock with available, threshold and where it came from', async () => {
    const result = await getStoreInventory({ warehouseId: lagos, perPage: 50 });
    if (!result.success) throw new Error(result.error);

    expect(result.data.stockedCount).toBe(5);
    const airmax = result.data.rows.find((r) => r.sku === 'AIRMAX')!;
    expect(airmax.onHand).toBe(10);
    expect(airmax.available).toBe(10);
    expect(airmax.reorderPoint).toBe(5);
    expect(airmax.reorderPointSource).toBe('product');
    expect(airmax.location).toBe('Aisle 4');
    expect(airmax.stockState).toBe('in');

    const a15 = result.data.rows.find((r) => r.sku === 'A15')!;
    expect(a15.reorderPoint).toBe(10);
    expect(a15.reorderPointSource).toBe('store');
    expect(a15.stockState).toBe('low');

    const mug = result.data.rows.find((r) => r.sku === 'MUG')!;
    expect(mug.onHand).toBe(4);
    expect(mug.held).toBe(4);
    expect(mug.stockState).toBe('out'); // on the shelf, but all of it is promised
  });

  it('shows a variant under its product’s name, and links to the product', async () => {
    const result = await getStoreInventory({ warehouseId: lagos, q: 'Snapback', perPage: 50 });
    if (!result.success) throw new Error(result.error);

    expect(result.data.rows).toHaveLength(1);
    const [row] = result.data.rows;
    expect(row.name).toBe('Snapback');
    expect(row.variantName).toBe('Red');
    expect(row.productId).toBe(items.get('CAP'));
    expect(row.itemId).toBe(items.get('CAP-RED'));
  });

  it('filters by stock level and searches name, SKU and shelf', async () => {
    const low = await getStoreInventory({ warehouseId: lagos, stock: 'low', perPage: 50 });
    const out = await getStoreInventory({ warehouseId: lagos, stock: 'out', perPage: 50 });
    const bySku = await getStoreInventory({ warehouseId: lagos, q: 'A15', perPage: 50 });
    const byShelf = await getStoreInventory({ warehouseId: lagos, q: 'Aisle', perPage: 50 });
    if (!low.success || !out.success || !bySku.success || !byShelf.success) throw new Error('expected four reads');

    expect(low.data.rows.map((r) => r.sku)).toEqual(['A15']);
    expect(out.data.rows.map((r) => r.sku).sort()).toEqual(['MUG', 'TEE']);
    expect(bySku.data.rows.map((r) => r.sku)).toEqual(['A15']);
    expect(byShelf.data.rows.map((r) => r.sku)).toEqual(['AIRMAX']);
    // A filter narrows the page, and still says how much is stocked here at all.
    expect(low.data.stockedCount).toBe(5);
  });

  it('sorts and pages', async () => {
    const page1 = await getStoreInventory({ warehouseId: lagos, sort: 'stock-asc', perPage: 5 });
    if (!page1.success) throw new Error(page1.error);
    // MUG and TEE both have nothing available; the name breaks the tie.
    expect(page1.data.rows.slice(0, 2).map((r) => r.sku)).toEqual(['MUG', 'TEE']);
    expect(page1.data.pageCount).toBe(1);

    const paged = await getStoreInventory({ warehouseId: lagos, perPage: 5, page: 2 });
    if (!paged.success) throw new Error(paged.error);
    expect(paged.data.page).toBe(1); // asked past the end, given the last page there is
    expect(paged.data.total).toBe(5);

    const byValue = await getStoreInventory({ warehouseId: lagos, sort: 'value-desc', perPage: 50 });
    if (!byValue.success) throw new Error(byValue.error);
    expect(byValue.data.rows[0].sku).toBe('A15'); // 7 × ₦150,000
  });

  it('cannot read another workspace’s store', async () => {
    const result = await getStoreInventory({ warehouseId: otherStore });
    expect(result).toEqual({ success: false, error: 'Store not found' });
  });
});

describe('getStoreActivity and getStoreOpenTransfers', () => {
  it('counts a transfer INTO this store as this store’s activity', async () => {
    const result = await getStoreActivity(lagos);
    if (!result.success) throw new Error(result.error);

    expect(result.data).toHaveLength(2);
    const transfer = result.data.find((m) => m.type === 'TRANSFER')!;
    // Recorded against Port Harcourt, destined here: from Lagos's side it came in.
    expect(transfer.incoming).toBe(true);
    expect(transfer.otherStoreName).toBe('Port Harcourt');
  });

  it('shows what is on its way, and which way it is going', async () => {
    const result = await getStoreOpenTransfers(lagos);
    if (!result.success) throw new Error(result.error);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ direction: 'in', otherStoreName: 'Port Harcourt', quantity: 4 });
  });
});
