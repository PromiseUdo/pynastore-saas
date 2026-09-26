/*
 * What a store sells (ROADMAP Phase 8.5).
 *
 * The figure is the goods that left a store's shelf at the price charged —
 * allocation units × line price. These cases pin the definition: a split order
 * counted exactly on both sides, delivery and discount codes left out,
 * cancelled orders and released holds counting for nobody, and one workspace's
 * takings never reaching another's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Store Sales Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { getStoreSales, getSalesByStore } = await import('@/features/sales/store-sales');

/** The window every case reads, with orders placed inside and outside it. */
const FROM = new Date('2026-09-01T00:00:00Z');
const TO = new Date('2026-10-01T00:00:00Z');

let lagos = '';
let portHarcourt = '';
let closedStore = '';
let otherStore = '';
let otherOrgId = '';
let airmax = '';
let mug = '';

async function order(input: {
  reference: string;
  channel: 'ONLINE' | 'WALK_IN';
  placedAt: Date;
  status?: 'CONFIRMED' | 'CANCELLED';
  warehouseId?: string;
  deliveryFee?: number;
  discount?: number;
  organizationId?: string;
  lines: {
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    from: [string, number][];
    status?: 'RESERVED' | 'DISPATCHED' | 'RELEASED';
  }[];
}) {
  const organizationId = input.organizationId ?? ctx.organization.id;
  const subtotal = input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const created = await prisma.order.create({
    data: {
      organizationId,
      reference: input.reference,
      channel: input.channel,
      status: input.status ?? 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentMethod: input.channel === 'ONLINE' ? 'card' : 'cash',
      warehouseId: input.warehouseId,
      firstName: 'Ada',
      lastName: 'Obi',
      placedAt: input.placedAt,
      subtotal,
      discount: input.discount ?? 0,
      deliveryFee: input.deliveryFee ?? null,
      totalAmount: subtotal - (input.discount ?? 0) + (input.deliveryFee ?? 0),
    },
  });

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
          organizationId,
          orderId: created.id,
          orderLineItemId: lineItem.id,
          inventoryItemId: line.itemId,
          warehouseId,
          quantity: units,
          status: line.status ?? 'DISPATCHED',
        },
      });
    }
  }
  return created.id;
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Store Sales Test', slug: `__test-storesales-${stamp}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];

  lagos = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Lagos', sellsOnline: true } })).id;
  portHarcourt = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Port Harcourt', sellsOnline: true } })).id;
  closedStore = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Old shop', status: 'INACTIVE' } })).id;

  const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-storesales-other-${stamp}` } });
  otherOrgId = other.id;
  otherStore = (await prisma.warehouse.create({ data: { organizationId: other.id, name: 'Somebody else' } })).id;
  const theirItem = await prisma.inventoryItem.create({ data: { organizationId: other.id, sku: 'THEIRS', name: 'Their product' } });

  airmax = (await prisma.inventoryItem.create({ data: { organizationId: org.id, sku: 'AIRMAX', name: 'Nike Air Max' } })).id;
  mug = (await prisma.inventoryItem.create({ data: { organizationId: org.id, sku: 'MUG', name: 'Enamel Mug' } })).id;

  // Online, split: 2 shoes from Lagos + 1 from Port Harcourt, 1 mug from Lagos.
  // Delivery and a discount code ride on the order and must not be counted.
  await order({
    reference: 'ORD-0001',
    channel: 'ONLINE',
    placedAt: new Date('2026-09-02T10:00:00Z'),
    deliveryFee: 3500,
    discount: 10000,
    lines: [
      { itemId: airmax, name: 'Nike Air Max', quantity: 3, unitPrice: 80000, from: [[lagos, 2], [portHarcourt, 1]] },
      { itemId: mug, name: 'Enamel Mug', quantity: 1, unitPrice: 5000, from: [[lagos, 1]] },
    ],
  });

  // A counter sale in Lagos.
  await order({
    reference: 'ORD-0002',
    channel: 'WALK_IN',
    placedAt: new Date('2026-09-04T10:00:00Z'),
    warehouseId: lagos,
    lines: [{ itemId: mug, name: 'Enamel Mug', quantity: 4, unitPrice: 5000, from: [[lagos, 4]] }],
  });

  // Cancelled: somebody changed their mind, so it is nobody's sale.
  await order({
    reference: 'ORD-0003',
    channel: 'ONLINE',
    placedAt: new Date('2026-09-06T10:00:00Z'),
    status: 'CANCELLED',
    lines: [{ itemId: airmax, name: 'Nike Air Max', quantity: 5, unitPrice: 80000, from: [[portHarcourt, 5]] }],
  });

  // Live order whose hold was given back: no store's sale, and unattributed.
  await order({
    reference: 'ORD-0004',
    channel: 'ONLINE',
    placedAt: new Date('2026-09-08T10:00:00Z'),
    lines: [{ itemId: mug, name: 'Enamel Mug', quantity: 2, unitPrice: 5000, from: [[lagos, 2]], status: 'RELEASED' }],
  });

  // Outside the window: the same shop, the month before.
  await order({
    reference: 'ORD-0005',
    channel: 'WALK_IN',
    placedAt: new Date('2026-08-20T10:00:00Z'),
    warehouseId: lagos,
    lines: [{ itemId: airmax, name: 'Nike Air Max', quantity: 10, unitPrice: 80000, from: [[lagos, 10]] }],
  });

  // Another workspace's sale, at their own store.
  await order({
    reference: 'THEIR-0001',
    channel: 'ONLINE',
    placedAt: new Date('2026-09-09T10:00:00Z'),
    organizationId: otherOrgId,
    lines: [{ itemId: theirItem.id, name: 'Their product', quantity: 7, unitPrice: 100000, from: [[otherStore, 7]] }],
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

describe('one store’s takings', () => {
  it('counts the goods off its own shelf, at the price charged, and splits the channels', async () => {
    const result = await getStoreSales({ warehouseId: lagos, from: FROM, to: TO });
    if (!result.success) throw new Error(result.error);

    // 2 × 80,000 + 1 × 5,000 online, 4 × 5,000 over the counter.
    expect(result.data.onlineValue).toBe(165_000);
    expect(result.data.counterValue).toBe(20_000);
    expect(result.data.goodsValue).toBe(185_000);
    expect(result.data.unitsSold).toBe(7);
    expect(result.data.orderCount).toBe(2);
  });

  it('leaves delivery and the order’s discount code out — they belong to the whole order', async () => {
    const lagosSales = await getStoreSales({ warehouseId: lagos, from: FROM, to: TO });
    const phSales = await getStoreSales({ warehouseId: portHarcourt, from: FROM, to: TO });
    if (!lagosSales.success || !phSales.success) throw new Error('expected both stores');

    // ORD-0001 charged 245,000 of goods, took 10,000 off and added 3,500 delivery.
    // The two stores' shares are the goods alone: 165,000 + 80,000.
    expect(lagosSales.data.onlineValue + phSales.data.onlineValue).toBe(245_000);
  });

  it('counts nothing for a cancelled order, or for a hold that went back', async () => {
    const result = await getStoreSales({ warehouseId: portHarcourt, from: FROM, to: TO });
    if (!result.success) throw new Error(result.error);

    // Only its 1 shoe from the split order: the cancelled 5 don't count.
    expect(result.data.goodsValue).toBe(80_000);
    expect(result.data.unitsSold).toBe(1);
  });

  it('respects the window, and `to` is exclusive', async () => {
    const august = await getStoreSales({
      warehouseId: lagos,
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-09-01T00:00:00Z'),
    });
    if (!august.success) throw new Error(august.error);
    expect(august.data.goodsValue).toBe(800_000); // only the August counter sale
  });

  it('is nothing at all for a store that sold nothing', async () => {
    const result = await getStoreSales({ warehouseId: closedStore, from: FROM, to: TO });
    if (!result.success) throw new Error(result.error);
    expect(result.data).toMatchObject({ goodsValue: 0, unitsSold: 0, orderCount: 0 });
  });

  it('cannot read another workspace’s store, and needs permission', async () => {
    const foreign = await getStoreSales({ warehouseId: otherStore, from: FROM, to: TO });
    expect(foreign).toEqual({ success: false, error: 'Store not found' });

    const granted = ctx.membership.role.permissions;
    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW];
    const denied = await getStoreSales({ warehouseId: lagos, from: FROM, to: TO });
    ctx.membership.role.permissions = granted;
    expect(denied.success).toBe(false);
  });
});

describe('sales by store', () => {
  it('lists every store, biggest seller first, with shares that add up', async () => {
    const result = await getSalesByStore({ from: FROM, to: TO });
    if (!result.success) throw new Error(result.error);

    expect(result.data.rows.map((r) => r.warehouseName)).toEqual(['Lagos', 'Port Harcourt', 'Old shop']);
    expect(result.data.rows[0]).toMatchObject({ goodsValue: 185_000, unitsSold: 7, orderCount: 2 });
    expect(result.data.rows[1]).toMatchObject({ goodsValue: 80_000, unitsSold: 1, orderCount: 1 });
    // A store that sold nothing is still listed — "nothing" is the answer.
    expect(result.data.rows[2]).toMatchObject({ goodsValue: 0, shareRatio: 0 });

    const shares = result.data.rows.reduce((sum, r) => sum + r.shareRatio, 0);
    expect(shares).toBeCloseTo(1, 10);
  });

  it('adds the stores up to the total, while counting a split order once', async () => {
    const result = await getSalesByStore({ from: FROM, to: TO });
    if (!result.success) throw new Error(result.error);

    const summed = result.data.rows.reduce((sum, r) => sum + r.goodsValue, 0);
    expect(result.data.totals.goodsValue).toBe(summed);
    expect(result.data.totals.goodsValue).toBe(265_000);
    // Two orders in the window have stock behind them: the split one and the counter sale.
    expect(result.data.totals.orderCount).toBe(2);
    // The store rows' own counts sum higher, which is why the footnote says so.
    expect(result.data.rows.reduce((sum, r) => sum + r.orderCount, 0)).toBe(3);
  });

  it('says what it cannot credit to any store', async () => {
    const result = await getSalesByStore({ from: FROM, to: TO });
    if (!result.success) throw new Error(result.error);

    // ORD-0004: live, but its hold went back, so no store earned it.
    expect(result.data.unattributed).toEqual({ orderCount: 1, goodsValue: 10_000 });
  });

  it('never counts another workspace’s sales', async () => {
    const result = await getSalesByStore({ from: FROM, to: TO });
    if (!result.success) throw new Error(result.error);

    expect(result.data.rows.map((r) => r.warehouseId)).not.toContain(otherStore);
    expect(result.data.totals.goodsValue).toBe(265_000); // their 700,000 is absent
  });
});
