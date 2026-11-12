/*
 * Returns for counter sales (ROADMAP 14.7), against the real database.
 *
 * The guarantees:
 *   - a counter sale brought back is recorded settled, in one step: the
 *     return, the money handed back (or none), and the stock back on the
 *     shelf of the store that sold it, with an IN movement;
 *   - never more of a line than is left, nor more money than was paid;
 *   - an exchange (nothing refunded) and an unpaid sale still record;
 *   - a refused return leaves nothing behind — no return, no refund, no stock;
 *   - online orders, cancelled sales, other workspaces and stores the member
 *     doesn't work in are refused.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
}));

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Counter Returns', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: {
    id: 'm',
    warehouseIds: [] as string[],
    role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] },
  },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const { recordCounterSale } = await import('@/features/sales/counter-sale');
const { recordCounterReturnAction } = await import('@/features/sales/order-returns');
const { getStoreOrder } = await import('@/features/sales/orders');

vi.setConfig({ testTimeout: 90_000 });

let shopId = '';
let otherShopId = '';
let otherOrgId = '';

async function product(name: string, quantity: number, price: number, warehouseId = shopId) {
  const item = await prisma.inventoryItem.create({
    data: { organizationId: ctx.organization.id, sku: `${name}-${Math.random().toString(36).slice(2, 7)}`, name, sellingPrice: price, status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId, quantity } });
  return item.id;
}

async function onShelf(inventoryItemId: string, warehouseId = shopId) {
  const level = await prisma.inventoryLevel.findUniqueOrThrow({
    where: { inventoryItemId_warehouseId: { inventoryItemId, warehouseId } },
    select: { quantity: true },
  });
  return Number(level.quantity);
}

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

/** A counter sale and its line ids, by product. */
async function sell(input: {
  lines: { id: string; quantity: number }[];
  paymentMethod?: 'cash' | 'transfer' | 'card' | 'later';
  discount?: number;
  warehouseId?: string;
}) {
  const sale = unwrap(
    await recordCounterSale({
      warehouseId: input.warehouseId ?? shopId,
      paymentMethod: input.paymentMethod ?? 'cash',
      discount: input.discount ?? 0,
      lines: input.lines.map((line) => ({ inventoryItemId: line.id, quantity: line.quantity })),
    }),
  );
  const lines = await prisma.orderLineItem.findMany({ where: { orderId: sale.orderId }, select: { id: true, productId: true } });
  const lineFor = (productId: string) => lines.find((l) => l.productId === productId)!.id;
  return { ...sale, lineFor };
}

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Counter Returns', slug: `__test-counter-returns-${suffix}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  shopId = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Shop floor' }, select: { id: true } })).id;
  otherShopId = (await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Ikeja branch' }, select: { id: true } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: 'Other', slug: `__test-counter-returns-other-${suffix}` } })).id;
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.orderRefund.deleteMany({ where: { organizationId } });
    await prisma.orderReturn.deleteMany({ where: { organizationId } });
    await prisma.orderStockAllocation.deleteMany({ where: { organizationId } });
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId } } });
    await prisma.order.deleteMany({ where: { organizationId } });
    await prisma.stockMovement.deleteMany({ where: { organizationId } });
    await prisma.inventoryLevel.deleteMany({ where: { inventoryItem: { organizationId } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId } });
    await prisma.warehouse.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

beforeEach(() => {
  ctx.membership.warehouseIds = [];
  ctx.membership.role.permissions = [PERMISSIONS.SALES_ORDER_CREATE, PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_RETURN_MANAGE];
});

describe('taking back a counter sale', () => {
  it('records the return settled, the cash given back, and the items back on that store’s shelf', async () => {
    const shirt = await product('Ankara shirt', 10, 5000);
    const sale = await sell({ lines: [{ id: shirt, quantity: 3 }] });
    expect(await onShelf(shirt)).toBe(7);

    const result = unwrap(
      await recordCounterReturnAction(sale.orderId, {
        lines: [{ orderLineItemId: sale.lineFor(shirt), quantity: 2 }],
        reason: 'doesnt-fit',
        refundAmount: 10_000,
        refundMethod: 'cash',
        refundNote: 'From the till',
        restock: true,
      }),
    );

    const ret = await prisma.orderReturn.findUniqueOrThrow({
      where: { id: result.returnId },
      select: { status: true, restocked: true, refundedAt: true, lines: { select: { quantity: true } }, refunds: { select: { amount: true, note: true } } },
    });
    expect(ret).toMatchObject({ status: 'REFUNDED', restocked: true, lines: [{ quantity: 2 }] });
    expect(ret.refundedAt).not.toBeNull();
    expect(ret.refunds.map((r) => [Number(r.amount), r.note])).toEqual([[10_000, 'Cash — From the till']]);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: sale.orderId }, select: { paymentStatus: true } });
    expect(order.paymentStatus).toBe('PARTIALLY_REFUNDED');

    expect(await onShelf(shirt)).toBe(9);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { referenceType: 'OrderReturn', referenceId: result.returnId } });
    expect(movement).toMatchObject({ type: 'IN', warehouseId: shopId, inventoryItemId: shirt });
    expect(Number(movement.quantity)).toBe(2);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: ctx.organization.id, action: 'sales.order_return.counter_recorded' } });
    expect(audit.entityId).toBe(result.returnId);

    // The order page now offers only what's left.
    const detail = unwrap(await getStoreOrder(sale.orderId));
    expect(detail.lines[0].returnable).toBe(1);
    expect(detail.returns[0].reasonLabel).toBe('Doesn’t fit');
  });

  it('never takes back more than is left of a line, nor more money than was paid — and a refusal leaves nothing', async () => {
    const mug = await product('Enamel mug', 5, 2000);
    const sale = await sell({ lines: [{ id: mug, quantity: 2 }] });
    const line = sale.lineFor(mug);

    const tooMany = await recordCounterReturnAction(sale.orderId, {
      lines: [{ orderLineItemId: line, quantity: 3 }],
      reason: 'changed-mind',
      refundAmount: 0,
      restock: true,
    });
    expect(tooMany).toMatchObject({ success: false, error: expect.stringMatching(/Only 2/) });

    const tooMuchMoney = await recordCounterReturnAction(sale.orderId, {
      lines: [{ orderLineItemId: line, quantity: 1 }],
      reason: 'changed-mind',
      refundAmount: 4_001,
      refundMethod: 'cash',
      restock: true,
    });
    expect(tooMuchMoney.success).toBe(false);

    // Neither left a return, a refund or a unit of stock behind.
    expect(await prisma.orderReturn.count({ where: { orderId: sale.orderId } })).toBe(0);
    expect(await prisma.orderRefund.count({ where: { orderId: sale.orderId } })).toBe(0);
    expect(await onShelf(mug)).toBe(3);

    // Both back, all the money: fully refunded, nothing more to return.
    unwrap(
      await recordCounterReturnAction(sale.orderId, {
        lines: [{ orderLineItemId: line, quantity: 2 }],
        reason: 'damaged',
        refundAmount: 4_000,
        refundMethod: 'transfer',
        restock: false,
      }),
    );
    const order = await prisma.order.findUniqueOrThrow({ where: { id: sale.orderId }, select: { paymentStatus: true } });
    expect(order.paymentStatus).toBe('REFUNDED');
    expect(await onShelf(mug)).toBe(3); // damaged: not restocked

    const again = await recordCounterReturnAction(sale.orderId, {
      lines: [{ orderLineItemId: line, quantity: 1 }],
      reason: 'damaged',
      refundAmount: 0,
      restock: false,
    });
    expect(again).toMatchObject({ success: false, error: expect.stringMatching(/already been returned/) });
  });

  it('takes an exchange with nothing refunded, and a sale that was never paid', async () => {
    const cap = await product('Bucket hat', 5, 3000);
    const paid = await sell({ lines: [{ id: cap, quantity: 1 }] });
    unwrap(
      await recordCounterReturnAction(paid.orderId, {
        lines: [{ orderLineItemId: paid.lineFor(cap), quantity: 1 }],
        reason: 'other',
        details: 'Swapped for a bigger size',
        refundAmount: 0,
        restock: true,
      }),
    );
    expect(await prisma.orderRefund.count({ where: { orderId: paid.orderId } })).toBe(0);
    const stillPaid = await prisma.order.findUniqueOrThrow({ where: { id: paid.orderId }, select: { paymentStatus: true } });
    expect(stillPaid.paymentStatus).toBe('PAID');

    const unpaid = await sell({ lines: [{ id: cap, quantity: 1 }], paymentMethod: 'later' });
    const refused = await recordCounterReturnAction(unpaid.orderId, {
      lines: [{ orderLineItemId: unpaid.lineFor(cap), quantity: 1 }],
      reason: 'changed-mind',
      refundAmount: 3000,
      refundMethod: 'cash',
      restock: true,
    });
    expect(refused).toMatchObject({ success: false, error: expect.stringMatching(/hasn’t been paid/) });
    unwrap(
      await recordCounterReturnAction(unpaid.orderId, {
        lines: [{ orderLineItemId: unpaid.lineFor(cap), quantity: 1 }],
        reason: 'changed-mind',
        refundAmount: 0,
        restock: true,
      }),
    );
    expect(await onShelf(cap)).toBe(5);
  });

  it('spreads the sale’s discount over what comes back, in the suggestion', async () => {
    const bag = await product('Tote bag', 5, 10_000);
    const sale = await sell({ lines: [{ id: bag, quantity: 2 }], discount: 2_000 });
    const ret = unwrap(
      await recordCounterReturnAction(sale.orderId, {
        lines: [{ orderLineItemId: sale.lineFor(bag), quantity: 1 }],
        reason: 'changed-mind',
        refundAmount: 9_000,
        refundMethod: 'card',
        restock: true,
      }),
    );
    const detail = unwrap(await getStoreOrder(sale.orderId));
    expect(detail.returns.find((r) => r.id === ret.returnId)?.suggestedRefund).toBe(9_000);
  });
});

describe('what it refuses', () => {
  it('asks how the money went back, and a note for "something else"', async () => {
    const item = await product('Scarf', 5, 1000);
    const sale = await sell({ lines: [{ id: item, quantity: 1 }] });
    const lines = [{ orderLineItemId: sale.lineFor(item), quantity: 1 }];
    expect(await recordCounterReturnAction(sale.orderId, { lines, reason: 'damaged', refundAmount: 1000, restock: true })).toMatchObject({
      success: false,
      error: expect.stringMatching(/how the money/),
    });
    expect(await recordCounterReturnAction(sale.orderId, { lines, reason: 'other', refundAmount: 0, restock: true })).toMatchObject({
      success: false,
      error: expect.stringMatching(/note/),
    });
  });

  it('refuses an online order — its shopper returns it from their account', async () => {
    const order = await prisma.order.create({
      data: {
        organizationId: ctx.organization.id,
        reference: `ORD-ONLINE-${Date.now()}`,
        channel: 'ONLINE',
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        paymentMethod: 'paystack',
        subtotal: 1000,
        totalAmount: 1000,
        lineItems: { create: { name: 'Thing', quantity: 1, unitPrice: 1000, totalPrice: 1000 } },
      },
      select: { id: true, lineItems: { select: { id: true } } },
    });
    const result = await recordCounterReturnAction(order.id, {
      lines: [{ orderLineItemId: order.lineItems[0].id, quantity: 1 }],
      reason: 'changed-mind',
      refundAmount: 0,
      restock: false,
    });
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/online order/i) });
  });

  it('needs the returns permission, and a store the member works in', async () => {
    const item = await product('Belt', 5, 1500);
    const sale = await sell({ lines: [{ id: item, quantity: 1 }] });
    const input = { lines: [{ orderLineItemId: sale.lineFor(item), quantity: 1 }], reason: 'changed-mind', refundAmount: 0, restock: true };

    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_ORDER_CREATE];
    expect((await recordCounterReturnAction(sale.orderId, input)).success).toBe(false);

    ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_RETURN_MANAGE];
    ctx.membership.warehouseIds = [otherShopId];
    expect(await recordCounterReturnAction(sale.orderId, input)).toMatchObject({ success: false, error: expect.stringMatching(/Shop floor/) });
    expect(await onShelf(item)).toBe(4);
  });

  it('never reaches another workspace’s sale', async () => {
    const theirs = await prisma.order.create({
      data: {
        organizationId: otherOrgId,
        reference: `ORD-THEIRS-${Date.now()}`,
        channel: 'WALK_IN',
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        paymentMethod: 'cash',
        subtotal: 1000,
        totalAmount: 1000,
        lineItems: { create: { name: 'Theirs', quantity: 1, unitPrice: 1000, totalPrice: 1000 } },
      },
      select: { id: true, lineItems: { select: { id: true } } },
    });
    const result = await recordCounterReturnAction(theirs.id, {
      lines: [{ orderLineItemId: theirs.lineItems[0].id, quantity: 1 }],
      reason: 'changed-mind',
      refundAmount: 0,
      restock: false,
    });
    expect(result).toMatchObject({ success: false, error: 'Order not found' });
    expect(await prisma.orderReturn.count({ where: { orderId: theirs.id } })).toBe(0);
  });
});
