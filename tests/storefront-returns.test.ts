/*
 * After the order: a shopper cancelling, asking to send items back, and the
 * merchant answering and recording refunds — against the real database.
 *
 * The rules that matter:
 *   - a shopper cancels only their OWN order, and only before packing; the
 *     stock goes back, and a paid order is left owing a refund;
 *   - a return can be asked for only on a delivered order, inside the
 *     store's own window, and never for more than is left of a line —
 *     declined requests count, withdrawn ones give their items back;
 *   - a refund can never exceed what was paid and not yet sent back, and the
 *     order's payment status follows the sum;
 *   - restocking puts units back in the store they were sent from.
 *
 * Email is stubbed at lib/email.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ shopper: [] as string[], merchant: [] as string[] }));
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async (payload: { kind: string }) => {
    sent.shopper.push(payload.kind);
  }),
  sendStoreOrderAlertEmail: vi.fn(async (payload: { kind: string }) => {
    sent.merchant.push(payload.kind);
  }),
  sendLowStockAlertEmail: vi.fn(async () => {}),
}));

import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { getDeliveryPromise } from '@/lib/storefront/catalog';
import { placeOrder } from '@/lib/storefront/orders/create';
import {
  cancelOrderForCustomer,
  confirmOrder,
  markOrderDelivered,
  markOrderShipped,
  startPacking,
} from '@/lib/storefront/orders/lifecycle';
import {
  approveReturn,
  refundCancelledOrder,
  refundReturn,
  rejectReturn,
  requestReturn,
  withdrawReturn,
} from '@/lib/storefront/orders/returns';
import { getOrderForCustomer } from '@/lib/storefront/orders/read';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';

/* Each case walks an order through placing, shipping and delivering against
 * Neon, which is slow from here — seconds a step, not milliseconds. */
vi.setConfig({ testTimeout: 90_000 });

const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-returns-${suffix}` };
let warehouseId = '';
let ownerId = '';
let deliveryMethodId = '';

const config = await getCheckoutConfig({ organizationSlug: 'demo' });

const contact = (who: string): CheckoutContact => ({
  firstName: 'Ada',
  lastName: 'Okoro',
  email: `${who}-${suffix}@example.com`,
  phone: '08012345678',
});

const ADDRESS: CheckoutAddress = {
  firstName: 'Ada',
  lastName: 'Okoro',
  phone: '08012345678',
  country: config.defaultCountryCode,
  state: 'Rivers',
  city: 'Port Harcourt',
  addressLine1: '12 Example Street',
  addressLine2: '',
  postalCode: '',
};

async function product(name: string, quantity: number) {
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId: store.id,
      name,
      sku: `${name}-${suffix}`.slice(0, 40),
      slug: `${name.toLowerCase()}-${suffix}`.slice(0, 60),
      sellingPrice: 1000,
      isPublished: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId, quantity } });
  return item.id;
}

/** A pay-on-delivery order; returns its ids and the customer it belongs to. */
async function placed(productId: string, quantity: number, who = 'ada') {
  const result = await placeOrder({
    organizationSlug: store.slug,
    customerId: null,
    lines: [{ productId, variantId: productId, quantity }],
    contact: contact(who),
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId: 'pod',
    note: '',
    config: await getStoreCheckoutConfig({ organizationSlug: store.slug }),
  });
  if (!result.ok) throw new Error(result.message);
  const row = await prisma.order.findUniqueOrThrow({
    where: { id: result.orderId },
    select: { customerId: true, lineItems: { select: { id: true } } },
  });
  return { ...result, customerId: row.customerId, lineId: row.lineItems[0].id };
}

/** Confirm → ship → deliver, paid to the courier. */
async function delivered(productId: string, quantity: number, who = 'ada') {
  const order = await placed(productId, quantity, who);
  const scope = { organizationId: store.id, orderId: order.orderId };
  expect((await confirmOrder(scope)).ok).toBe(true);
  expect((await markOrderShipped({ ...scope, organizationSlug: store.slug, performedById: null })).ok).toBe(true);
  expect((await markOrderDelivered({ ...scope, paymentCollected: true })).ok).toBe(true);
  return order;
}

const shelf = async (productId: string) => {
  const level = await prisma.inventoryLevel.findFirstOrThrow({ where: { inventoryItemId: productId, warehouseId } });
  return { quantity: Number(level.quantity), reserved: Number(level.reservedQty) };
};

const setWindow = (days: number | null) =>
  prisma.organization.update({ where: { id: store.id }, data: { returnWindowDays: days } });

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Returns Store', slug: store.slug } })).id;
  deliveryMethodId = await giveStoreDelivery(store.id);
  warehouseId = (
    await prisma.warehouse.create({ data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' } })
  ).id;
  /* An Owner to be told — the one role that hears about everything, whatever
   * its stored permissions say. */
  ownerId = (await prisma.user.create({ data: { email: `owner-${suffix}@example.com` } })).id;
  const role = await prisma.role.create({ data: { organizationId: store.id, name: 'Owner', isSystem: true } });
  await prisma.membership.create({ data: { userId: ownerId, organizationId: store.id, roleId: role.id } });
});

beforeEach(async () => {
  sent.shopper.length = 0;
  sent.merchant.length = 0;
  await setWindow(14);
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;

  await prisma.orderStockAllocation.deleteMany({ where: { organizationId: store.id } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.membership.deleteMany({ where: { organizationId: store.id } });
  await prisma.role.deleteMany({ where: { organizationId: store.id } });
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.organization.delete({ where: { id: store.id } });
});

/* ---------------- the store's promise ---------------- */

describe('the return window is the merchant’s', () => {
  it('is what the product page quotes — and nothing at all when they haven’t set one', async () => {
    expect((await getDeliveryPromise({ organizationSlug: store.slug })).returnWindowDays).toBe(14);
    await setWindow(null);
    expect((await getDeliveryPromise({ organizationSlug: store.slug })).returnWindowDays).toBeNull();
  });
});

/* ---------------- cancelling ---------------- */

describe('a shopper cancelling', () => {
  it('cancels their own order before packing, puts the stock back, and tells both sides', async () => {
    const id = await product('Cancel', 5);
    const order = await placed(id, 2);
    expect(await shelf(id)).toEqual({ quantity: 5, reserved: 2 });

    const result = await cancelOrderForCustomer({
      organizationId: store.id,
      customerId: order.customerId,
      reference: order.reference,
      note: 'Ordered the wrong size',
    });

    expect(result.ok).toBe(true);
    expect(await shelf(id)).toEqual({ quantity: 5, reserved: 0 });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row).toMatchObject({ status: 'CANCELLED', cancelReason: 'customer', cancelNote: 'Ordered the wrong size' });
    expect(sent.shopper).toEqual(['cancelled-by-you']);
    expect(sent.merchant).toEqual(['customer-cancelled']);
  });

  it('can’t reach someone else’s order, or one the store has started packing', async () => {
    const id = await product('CantCancel', 5);
    const mine = await placed(id, 1, 'mine');
    const theirs = await placed(id, 1, 'theirs');

    const wrongCustomer = await cancelOrderForCustomer({
      organizationId: store.id,
      customerId: theirs.customerId,
      reference: mine.reference,
    });
    expect(wrongCustomer.ok).toBe(false);

    await confirmOrder({ organizationId: store.id, orderId: mine.orderId });
    await startPacking({ organizationId: store.id, orderId: mine.orderId });
    const packing = await cancelOrderForCustomer({
      organizationId: store.id,
      customerId: mine.customerId,
      reference: mine.reference,
    });
    expect(packing.ok).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: mine.orderId } })).status).toBe('PROCESSING');
  });

  it('leaves a paid order owing its money back until the merchant records the refund', async () => {
    const id = await product('PaidCancel', 5);
    const order = await placed(id, 2);
    await prisma.order.update({ where: { id: order.orderId }, data: { paymentStatus: 'PAID', paidAt: new Date() } });
    await cancelOrderForCustomer({ organizationId: store.id, customerId: order.customerId, reference: order.reference });

    const read = async () =>
      (await getOrderForCustomer({ organizationId: store.id }, order.customerId, order.reference))!;
    const total = (await read()).totals.total;
    expect((await read()).refunds).toMatchObject({ total: 0, owed: total });
    expect((await read()).cancellation?.by).toBe('customer');

    const refund = (amount: number) =>
      refundCancelledOrder({ organizationId: store.id, orderId: order.orderId, amount, performedById: null });

    expect((await refund(total / 100 + 1)).ok).toBe(false); // more than was paid
    expect((await refund(500)).ok).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).paymentStatus).toBe(
      'PARTIALLY_REFUNDED',
    );
    expect((await read()).refunds).toMatchObject({ total: 50_000, owed: total - 50_000 });

    expect((await refund(total / 100 - 500)).ok).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).paymentStatus).toBe('REFUNDED');
    expect((await refund(1)).ok).toBe(false); // nothing left
    expect(sent.shopper.filter((k) => k === 'refunded')).toHaveLength(2);
  });
});

/* ---------------- returns ---------------- */

describe('asking to return items', () => {
  it('only works on a delivered order, inside the store’s window, if the store takes returns', async () => {
    const id = await product('Window', 10);

    const notYet = await placed(id, 1);
    const early = await requestReturn({
      organizationId: store.id,
      customerId: notYet.customerId,
      reference: notYet.reference,
      lines: [{ orderLineItemId: notYet.lineId, quantity: 1 }],
      reason: 'changed-mind',
    });
    expect(early.ok).toBe(false);

    const order = await delivered(id, 1);
    const ask = (now?: Date) =>
      requestReturn({
        organizationId: store.id,
        customerId: order.customerId,
        reference: order.reference,
        lines: [{ orderLineItemId: order.lineId, quantity: 1 }],
        reason: 'changed-mind',
        now,
      });

    await setWindow(null);
    expect(await ask()).toEqual({ ok: false, error: expect.stringMatching(/doesn’t take returns/) });

    await setWindow(14);
    expect((await ask(new Date(Date.now() + 15 * 86_400_000))).ok).toBe(false);
    expect((await ask()).ok).toBe(true);
    expect(sent.merchant).toContain('return-requested');
    expect(sent.shopper).toContain('return-requested');
  });

  it('never covers more than is left of a line; a decline is final, a withdrawal gives it back', async () => {
    const id = await product('Qty', 10);
    const order = await delivered(id, 2);
    const ask = (quantity: number) =>
      requestReturn({
        organizationId: store.id,
        customerId: order.customerId,
        reference: order.reference,
        lines: [{ orderLineItemId: order.lineId, quantity }],
        reason: 'doesnt-fit',
      });

    expect((await ask(3)).ok).toBe(false);

    const first = await ask(1);
    if (!first.ok) throw new Error(first.error);
    expect((await ask(2)).ok).toBe(false); // only 1 left

    // Withdrawn: the unit is free again.
    expect((await withdrawReturn({ organizationId: store.id, customerId: order.customerId, returnId: first.data.id })).ok).toBe(true);
    const second = await ask(2);
    if (!second.ok) throw new Error(second.error);

    // Declined: final — nothing left to ask for.
    expect((await rejectReturn({ organizationId: store.id, returnId: second.data.id, note: '' })).ok).toBe(false);
    expect((await rejectReturn({ organizationId: store.id, returnId: second.data.id, note: 'It’s been worn' })).ok).toBe(true);
    expect((await ask(1)).ok).toBe(false);

    // …and a declined request can't be withdrawn or refunded.
    expect((await withdrawReturn({ organizationId: store.id, customerId: order.customerId, returnId: second.data.id })).ok).toBe(false);
    expect(
      (await refundReturn({ organizationId: store.id, returnId: second.data.id, amount: 1000, restock: true, performedById: null })).ok,
    ).toBe(false);
  });

  it('two requests racing for the last unit: one wins', async () => {
    const id = await product('Race', 10);
    const order = await delivered(id, 1);
    const ask = () =>
      requestReturn({
        organizationId: store.id,
        customerId: order.customerId,
        reference: order.reference,
        lines: [{ orderLineItemId: order.lineId, quantity: 1 }],
        reason: 'changed-mind',
      });

    const results = await Promise.all([ask(), ask(), ask()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('refunding with restock puts the units back where they were sent from and moves the payment status', async () => {
    const id = await product('Restock', 10);
    const order = await delivered(id, 3);
    expect(await shelf(id)).toEqual({ quantity: 7, reserved: 0 });

    const asked = await requestReturn({
      organizationId: store.id,
      customerId: order.customerId,
      reference: order.reference,
      lines: [{ orderLineItemId: order.lineId, quantity: 2 }],
      reason: 'damaged',
      details: 'Two arrived cracked',
    });
    if (!asked.ok) throw new Error(asked.error);

    expect((await approveReturn({ organizationId: store.id, returnId: asked.data.id, note: 'Drop them at our shop' })).ok).toBe(true);
    expect(sent.shopper).toContain('return-approved');

    const refunded = await refundReturn({
      organizationId: store.id,
      returnId: asked.data.id,
      amount: 2000,
      restock: true,
      performedById: null,
    });
    expect(refunded.ok).toBe(true);
    expect(await shelf(id)).toEqual({ quantity: 9, reserved: 0 });

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceType: 'OrderReturn', referenceId: asked.data.id },
    });
    expect(movement).toMatchObject({ type: 'IN', warehouseId });
    expect(Number(movement?.quantity)).toBe(2);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.paymentStatus).toBe('PARTIALLY_REFUNDED');

    // Settled once: refunding the same return again is refused and restocks nothing.
    expect(
      (await refundReturn({ organizationId: store.id, returnId: asked.data.id, amount: 1, restock: true, performedById: null })).ok,
    ).toBe(false);
    expect(await shelf(id)).toEqual({ quantity: 9, reserved: 0 });

    const read = (await getOrderForCustomer({ organizationId: store.id }, order.customerId, order.reference))!;
    expect(read.returns[0]).toMatchObject({ status: 'REFUNDED', refunded: 200_000, storeNote: 'Drop them at our shop' });
    expect(read.selfService.returns.open && read.selfService.returns.remaining).toEqual({ [order.lineId]: 1 });
  });

  it('a refused refund leaves the return open — the status change rolls back with it', async () => {
    const id = await product('Rollback', 10);
    const order = await delivered(id, 1);
    const asked = await requestReturn({
      organizationId: store.id,
      customerId: order.customerId,
      reference: order.reference,
      lines: [{ orderLineItemId: order.lineId, quantity: 1 }],
      reason: 'changed-mind',
    });
    if (!asked.ok) throw new Error(asked.error);

    const tooMuch = await refundReturn({
      organizationId: store.id,
      returnId: asked.data.id,
      amount: 1_000_000,
      restock: true,
      performedById: null,
    });
    expect(tooMuch.ok).toBe(false);
    expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: asked.data.id } })).status).toBe('REQUESTED');
    expect(await shelf(id)).toEqual({ quantity: 9, reserved: 0 });
  });
});
