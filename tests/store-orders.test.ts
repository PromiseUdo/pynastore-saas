/*
 * Which store an order came off (ROADMAP Phase 8.4).
 *
 * `OrderStockAllocation` has recorded this since Phase 2 and nothing read it.
 * These cases pin the read: a split order naming both stores line by line, a
 * counter sale naming its shop, a released hold naming nobody, and a store's
 * own order list covering both channels without reaching another workspace's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Store Orders Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { listStoreOrders, getStoreOrder } = await import('@/features/sales/orders');

let lagos = '';
let portHarcourt = '';
let otherStore = '';
let otherOrgId = '';
let airmax = '';
let mug = '';

const orders: Record<string, string> = {};

/**
 * An order with its lines and the allocations behind them, written straight
 * to the database — the same shape `reserveOrderStock` leaves behind.
 */
async function order(input: {
  key: string;
  reference: string;
  channel: 'ONLINE' | 'WALK_IN';
  placedAt: Date;
  warehouseId?: string;
  firstName?: string;
  lines: {
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    /** [store, units] per store the line was taken from */
    from: [string, number][];
    status?: 'RESERVED' | 'DISPATCHED' | 'RELEASED';
  }[];
}) {
  const total = input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const created = await prisma.order.create({
    data: {
      organizationId: ctx.organization.id,
      reference: input.reference,
      channel: input.channel,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentMethod: input.channel === 'ONLINE' ? 'card' : 'cash',
      warehouseId: input.warehouseId,
      firstName: input.firstName ?? 'Ada',
      lastName: 'Obi',
      email: 'ada@example.test',
      placedAt: input.placedAt,
      subtotal: total,
      totalAmount: total,
    },
  });
  orders[input.key] = created.id;

  for (const line of input.lines) {
    const lineItem = await prisma.orderLineItem.create({
      data: {
        orderId: created.id,
        productId: line.itemId,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.unitPrice * line.quantity,
      },
    });
    for (const [warehouseId, units] of line.from) {
      await prisma.orderStockAllocation.create({
        data: {
          organizationId: ctx.organization.id,
          orderId: created.id,
          orderLineItemId: lineItem.id,
          inventoryItemId: line.itemId,
          warehouseId,
          quantity: units,
          status: line.status ?? 'RESERVED',
        },
      });
    }
  }
  return created.id;
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Store Orders Test', slug: `__test-storeorders-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW, PERMISSIONS.INVENTORY_VIEW];

  lagos = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos', sellsOnline: true } })).id;
  portHarcourt = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Port Harcourt', sellsOnline: true } })).id;

  const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-storeorders-other-${stamp}` } });
  otherOrgId = other.id;
  otherStore = (await prisma.warehouse.create({ data: { organizationId: other.id, name: 'Somebody else' } })).id;

  airmax = (await prisma.inventoryItem.create({ data: { organizationId: org.id, sku: 'AIRMAX', name: 'Nike Air Max' } })).id;
  mug = (await prisma.inventoryItem.create({ data: { organizationId: org.id, sku: 'MUG', name: 'Enamel Mug' } })).id;

  // One online order split across two stores: 2 from Lagos, 1 from Port Harcourt.
  await order({
    key: 'split',
    reference: 'ORD-0001',
    channel: 'ONLINE',
    placedAt: new Date('2026-09-01T09:00:00Z'),
    lines: [
      { itemId: airmax, name: 'Nike Air Max', quantity: 3, unitPrice: 80000, from: [[lagos, 2], [portHarcourt, 1]] },
      { itemId: mug, name: 'Enamel Mug', quantity: 1, unitPrice: 5000, from: [[lagos, 1]] },
    ],
  });

  // An online order Port Harcourt filled on its own, placed later.
  await order({
    key: 'ph-only',
    reference: 'ORD-0002',
    channel: 'ONLINE',
    placedAt: new Date('2026-09-05T09:00:00Z'),
    firstName: 'Chidi',
    lines: [{ itemId: mug, name: 'Enamel Mug', quantity: 2, unitPrice: 5000, from: [[portHarcourt, 2]] }],
  });

  // A counter sale rung up in Lagos.
  await order({
    key: 'counter',
    reference: 'ORD-0003',
    channel: 'WALK_IN',
    placedAt: new Date('2026-09-10T09:00:00Z'),
    warehouseId: lagos,
    firstName: 'Bola',
    lines: [{ itemId: airmax, name: 'Nike Air Max', quantity: 1, unitPrice: 80000, from: [[lagos, 1]], status: 'DISPATCHED' }],
  });

  // A cancelled order whose hold went back to Lagos.
  await order({
    key: 'released',
    reference: 'ORD-0004',
    channel: 'ONLINE',
    placedAt: new Date('2026-09-12T09:00:00Z'),
    firstName: 'Ngozi',
    lines: [{ itemId: mug, name: 'Enamel Mug', quantity: 1, unitPrice: 5000, from: [[lagos, 1]], status: 'RELEASED' }],
  });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.orderStockAllocation.deleteMany({ where: { organizationId } });
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId } } });
    await prisma.order.deleteMany({ where: { organizationId } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

describe('an order says which store it came off', () => {
  it('names both stores, biggest share first, and says it line by line', async () => {
    const result = await getStoreOrder(orders.split);
    if (!result.success) throw new Error(result.error);

    expect(result.data.fulfilledFrom).toEqual([
      { warehouseId: lagos, name: 'Lagos', units: 3 },
      { warehouseId: portHarcourt, name: 'Port Harcourt', units: 1 },
    ]);

    const shoes = result.data.lines.find((line) => line.name === 'Nike Air Max')!;
    expect(shoes.fromStores).toEqual([
      { warehouseId: lagos, name: 'Lagos', units: 2 },
      { warehouseId: portHarcourt, name: 'Port Harcourt', units: 1 },
    ]);
    const mugLine = result.data.lines.find((line) => line.name === 'Enamel Mug')!;
    expect(mugLine.fromStores).toEqual([{ warehouseId: lagos, name: 'Lagos', units: 1 }]);
    expect(result.data.stockReleased).toBe(false);
  });

  it('names the shop a counter sale was rung up in', async () => {
    const result = await getStoreOrder(orders.counter);
    if (!result.success) throw new Error(result.error);

    expect(result.data.storeName).toBe('Lagos');
    expect(result.data.fulfilledFrom).toEqual([{ warehouseId: lagos, name: 'Lagos', units: 1 }]);
  });

  it('names nobody once the hold has gone back, and says that is what happened', async () => {
    const result = await getStoreOrder(orders.released);
    if (!result.success) throw new Error(result.error);

    expect(result.data.fulfilledFrom).toEqual([]);
    expect(result.data.stockReleased).toBe(true);
    expect(result.data.lines[0].fromStores).toEqual([]);
  });
});

describe('a store’s own order list', () => {
  it('covers both channels: rung up here, or filled from this shelf', async () => {
    const result = await listStoreOrders({ warehouseId: lagos, sort: 'oldest' });
    if (!result.success) throw new Error(result.error);

    // Oldest first, and the released one is still Lagos's order — it happened here.
    expect(result.data.rows.map((r) => r.reference)).toEqual(['ORD-0001', 'ORD-0003', 'ORD-0004']);
    const [split, counter] = result.data.rows;
    expect(split.unitsFromStore).toBe(3);
    expect(counter.unitsFromStore).toBe(1);
    // A released hold is no longer any store's share.
    expect(result.data.rows[2].unitsFromStore).toBe(0);
  });

  it('leaves out an order another store filled', async () => {
    const result = await listStoreOrders({ warehouseId: portHarcourt, sort: 'oldest' });
    if (!result.success) throw new Error(result.error);
    expect(result.data.rows.map((r) => r.reference)).toEqual(['ORD-0001', 'ORD-0002']);
  });

  it('newest first by default, and every store when none is named', async () => {
    const result = await listStoreOrders();
    if (!result.success) throw new Error(result.error);
    expect(result.data.rows.map((r) => r.reference)).toEqual(['ORD-0004', 'ORD-0003', 'ORD-0002', 'ORD-0001']);
  });

  it('applies a search AND the store filter, not one instead of the other', async () => {
    const both = await listStoreOrders({ warehouseId: portHarcourt, q: 'Chidi' });
    const mismatch = await listStoreOrders({ warehouseId: lagos, q: 'Chidi' });
    if (!both.success || !mismatch.success) throw new Error('expected two reads');

    expect(both.data.rows.map((r) => r.reference)).toEqual(['ORD-0002']);
    // Chidi's order was filled by Port Harcourt, so Lagos has nothing matching.
    expect(mismatch.data.rows).toEqual([]);
  });

  it('shows every store an order came off, for the list’s own subtitle', async () => {
    const result = await listStoreOrders({ q: 'ORD-0001' });
    if (!result.success) throw new Error(result.error);
    expect(result.data.rows[0].fulfilledFrom.map((s) => s.name)).toEqual(['Lagos', 'Port Harcourt']);
    expect(result.data.rows[0].unitsFromStore).toBeNull();
  });

  it('narrows to nothing for another workspace’s store', async () => {
    const result = await listStoreOrders({ warehouseId: otherStore });
    if (!result.success) throw new Error(result.error);
    expect(result.data.rows).toEqual([]);
    // The unfiltered totals still describe this workspace, not the other one.
    expect(result.data.historySize).toBe(4);
  });

  it('needs permission to see sales at all', async () => {
    const granted = ctx.membership.role.permissions;
    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW];
    const result = await listStoreOrders({ warehouseId: lagos });
    ctx.membership.role.permissions = granted;
    expect(result.success).toBe(false);
  });
});
