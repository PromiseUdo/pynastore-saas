/*
 * Store access for staff, against the real database (ROADMAP Phase 8.6).
 *
 * The pure rule lives in lib/store-access.test.ts. These cases check the thing
 * that matters in practice: that a member limited to Lagos cannot change Port
 * Harcourt's stock through any of the doors that name a store, while everything
 * a member with no limit does carries on exactly as before.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Store Access Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: {
    id: 'm',
    role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] },
    /** Empty = every store, exactly as the real context reports it. */
    warehouseIds: [] as string[],
  },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { createStockMovement, recordStockIn } = await import('@/features/inventory/stock');
const { dispatchTransfer, receiveTransfer, cancelTransfer } = await import('@/features/inventory/transfers');
const { createCycleCount } = await import('@/features/inventory/cycle-counts');
const { setItemLocation } = await import('@/features/inventory/putaway');
const { listWarehouses, setWarehouseSellsOnline } = await import('@/features/inventory/warehouses');
const { assignProductsToStore, setStoreStockSettings } = await import('@/features/inventory/store-products');
const { getStoreDetail } = await import('@/features/inventory/store-detail');

let lagos = '';
let portHarcourt = '';
let tee = '';

/** Run something as a member limited to these stores. */
async function asScopedMember<T>(warehouseIds: string[], run: () => Promise<T>): Promise<T> {
  ctx.membership.warehouseIds = warehouseIds;
  try {
    return await run();
  } finally {
    ctx.membership.warehouseIds = [];
  }
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Store Access Test', slug: `__test-storeaccess-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_EDIT,
    PERMISSIONS.INVENTORY_CREATE,
    PERMISSIONS.INVENTORY_MOVEMENT_CREATE,
    PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE,
  ];

  lagos = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos' } })).id;
  portHarcourt = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Port Harcourt' } })).id;

  tee = (await prisma.inventoryItem.create({ data: { organizationId: org.id, sku: 'TEE', name: 'Plain Tee' } })).id;
  // Stock on both shelves, so nothing below fails merely for want of stock.
  await prisma.inventoryLevel.create({ data: { inventoryItemId: tee, warehouseId: lagos, quantity: 50 } });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: tee, warehouseId: portHarcourt, quantity: 50 } });
});

afterEach(() => {
  ctx.membership.warehouseIds = [];
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.cycleCountItem.deleteMany({ where: { cycleCount: { organizationId } } });
  await prisma.cycleCount.deleteMany({ where: { organizationId } });
  await prisma.stockTransfer.deleteMany({ where: { organizationId } });
  await prisma.stockMovement.deleteMany({ where: { organizationId } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId } });
  await prisma.warehouse.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('a member with no limit works everywhere, as before', () => {
  it('may move stock in either store', async () => {
    const here = await createStockMovement({ inventoryItemId: tee, warehouseId: lagos, type: 'IN', quantity: 1 });
    const there = await createStockMovement({ inventoryItemId: tee, warehouseId: portHarcourt, type: 'IN', quantity: 1 });
    expect(here.success).toBe(true);
    expect(there.success).toBe(true);
  });

  it('sees every store as one it can work in', async () => {
    const result = await listWarehouses();
    if (!result.success) throw new Error(result.error);
    expect(result.data.every((w) => w.canWorkHere)).toBe(true);
  });
});

describe('a member limited to Lagos', () => {
  it('may move stock in Lagos and not in Port Harcourt', async () => {
    await asScopedMember([lagos], async () => {
      const allowed = await createStockMovement({ inventoryItemId: tee, warehouseId: lagos, type: 'IN', quantity: 2 });
      expect(allowed.success).toBe(true);

      const refused = await createStockMovement({ inventoryItemId: tee, warehouseId: portHarcourt, type: 'IN', quantity: 2 });
      expect(refused.success).toBe(false);
      if (refused.success) throw new Error('expected a refusal');
      // The message says what to do about it, not just that it failed.
      expect(refused.error).toContain('Port Harcourt');
      expect(refused.error).toContain('Ask an admin');
    });
  });

  it('cannot record stock arriving at another store', async () => {
    await asScopedMember([lagos], async () => {
      const refused = await recordStockIn({ warehouseId: portHarcourt, lines: [{ inventoryItemId: tee, quantity: 5 }] });
      expect(refused.success).toBe(false);
    });

    // And nothing landed on that shelf.
    const level = await prisma.inventoryLevel.findUnique({
      where: { inventoryItemId_warehouseId: { inventoryItemId: tee, warehouseId: portHarcourt } },
    });
    expect(Number(level!.quantity)).toBe(51); // only the unscoped movement above
  });

  it('can send stock away but not receive it back — the other end does that', async () => {
    const sent = await asScopedMember([lagos], () =>
      dispatchTransfer({ inventoryItemId: tee, fromWarehouseId: lagos, toWarehouseId: portHarcourt, quantity: 3 }),
    );
    if (!sent.success) throw new Error(sent.error);

    const refused = await asScopedMember([lagos], () => receiveTransfer(sent.data.id));
    expect(refused.success).toBe(false);

    // Port Harcourt's own staff can take it in.
    const received = await asScopedMember([portHarcourt], () => receiveTransfer(sent.data.id));
    expect(received.success).toBe(true);
  });

  it('cannot send another store’s stock away, or cancel its transfer', async () => {
    const refusedDispatch = await asScopedMember([lagos], () =>
      dispatchTransfer({ inventoryItemId: tee, fromWarehouseId: portHarcourt, toWarehouseId: lagos, quantity: 1 }),
    );
    expect(refusedDispatch.success).toBe(false);

    const sentFromPh = await asScopedMember([portHarcourt], () =>
      dispatchTransfer({ inventoryItemId: tee, fromWarehouseId: portHarcourt, toWarehouseId: lagos, quantity: 1 }),
    );
    if (!sentFromPh.success) throw new Error(sentFromPh.error);

    const refusedCancel = await asScopedMember([lagos], () => cancelTransfer(sentFromPh.data.id));
    expect(refusedCancel.success).toBe(false);
    expect((await asScopedMember([portHarcourt], () => cancelTransfer(sentFromPh.data.id))).success).toBe(true);
  });

  it('cannot count, re-shelve or re-price another store’s stock', async () => {
    await asScopedMember([lagos], async () => {
      expect((await createCycleCount({ warehouseId: portHarcourt, itemIds: [tee] })).success).toBe(false);
      expect((await setItemLocation({ inventoryItemId: tee, warehouseId: portHarcourt, location: 'Aisle 9' })).success).toBe(false);
      expect(
        (
          await setStoreStockSettings({
            warehouseId: portHarcourt,
            inventoryItemId: tee,
            reorderPoint: 99,
            reorderQty: null,
            location: null,
          })
        ).success,
      ).toBe(false);

      // Its own store is untouched by any of that.
      expect((await createCycleCount({ warehouseId: lagos, itemIds: [tee] })).success).toBe(true);
    });
  });

  it('cannot add products to another store, or change whether it sells online', async () => {
    const other = await prisma.inventoryItem.create({
      data: { organizationId: ctx.organization.id, sku: 'MUG', name: 'Enamel Mug' },
    });

    await asScopedMember([lagos], async () => {
      expect((await assignProductsToStore({ warehouseId: portHarcourt, lines: [{ inventoryItemId: other.id }] })).success).toBe(false);
      expect((await setWarehouseSellsOnline(portHarcourt, true)).success).toBe(false);
    });

    expect(
      await prisma.inventoryLevel.count({ where: { inventoryItemId: other.id, warehouseId: portHarcourt } }),
    ).toBe(0);
    const store = await prisma.warehouse.findUnique({ where: { id: portHarcourt }, select: { sellsOnline: true } });
    expect(store!.sellsOnline).toBe(false);
  });

  it('can still SEE another store — reads are not scoped', async () => {
    await asScopedMember([lagos], async () => {
      const stores = await listWarehouses();
      if (!stores.success) throw new Error(stores.error);
      expect(stores.data).toHaveLength(2);
      expect(stores.data.find((w) => w.id === lagos)!.canWorkHere).toBe(true);
      expect(stores.data.find((w) => w.id === portHarcourt)!.canWorkHere).toBe(false);

      // Opening the other store's page works; it just says it is view-only.
      const detail = await getStoreDetail(portHarcourt);
      if (!detail.success) throw new Error(detail.error);
      expect(detail.data.canWorkHere).toBe(false);
      expect(detail.data.unitsOnHand).toBeGreaterThan(0);
    });
  });
});
