/*
 * What an online order does to stock, payment state and the shopper's inbox,
 * from placing it to delivering (or cancelling) it — against the real database.
 *
 * The rules that matter:
 *   - placing an order HOLDS its stock, in the same transaction, and two
 *     shoppers can never both hold the last unit;
 *   - shipping turns the hold into a real stock-out; cancelling gives it back;
 *   - an online order nobody pays for gives its stock back after the hold
 *     window, and a payment arriving after that revives it only if the stock
 *     can still be held;
 *   - pay on delivery never touches Squad, and is paid when the merchant says
 *     the courier collected;
 *   - every one of those moves emails the shopper, once.
 *
 * Squad is stubbed at `fetch` and email at lib/email.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@react-email/components';

const sentEmails = vi.hoisted(() => [] as { to: string; kind: string; reference: string }[]);
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async (payload: { to: string; kind: string; reference: string }) => {
    sentEmails.push({ to: payload.to, kind: payload.kind, reference: payload.reference });
  }),
  sendLowStockAlertEmail: vi.fn(async () => {}),
}));

import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { getProductsByIds } from '@/lib/storefront/catalog';
import { placeOrder } from '@/lib/storefront/orders/create';
import { reconcilePayment, startOrderPayment } from '@/lib/storefront/checkout/payment-service';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { TRANSFER_HOLD_HOURS } from '@/lib/storefront/mock/checkout';
import {
  UNPAID_ORDER_HOLD_MINUTES,
  cancelOrder,
  confirmOrder,
  confirmTransferReceived,
  expireUnpaidOrders,
  markOrderDelivered,
  markOrderShipped,
  recordDeliveryPayment,
  startPacking,
} from '@/lib/storefront/orders/lifecycle';
import { orderTimeline } from '@/lib/storefront/orders/labels';
import { notifyShopper } from '@/lib/storefront/orders/notifications';
import { StorefrontOrderUpdateEmail, type OrderEmailKind } from '@/emails/storefront-order-update';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';

process.env.SQUADCO_SECRET_KEY = 'sandbox_sk_test_secret_for_vitest';
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-lifecycle-${suffix}` };
const warehouses = { main: '', annex: '', shopFloor: '' };

const config = await getCheckoutConfig({ organizationSlug: 'demo' });

const CONTACT: CheckoutContact = {
  firstName: 'Ada',
  lastName: 'Okoro',
  email: `ada-life-${suffix}@example.com`,
  phone: '08012345678',
};

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

/* ---------------- a fake Squad ---------------- */

const squadVerify = new Map<string, string>();

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (url.endsWith('/transaction/initiate')) {
    const body = JSON.parse(String(init?.body));
    return json(200, { success: true, data: { checkout_url: `https://pay.test/${body.transaction_ref}` } });
  }
  const verify = url.match(/\/transaction\/verify\/(.+)$/);
  if (verify) {
    const ref = decodeURIComponent(verify[1]);
    const status = squadVerify.get(ref);
    if (!status) return json(400, { success: false, message: 'Invalid', data: null });
    const attempt = await prisma.orderPayment.findUniqueOrThrow({ where: { reference: ref } });
    return json(200, {
      success: true,
      data: {
        transaction_ref: ref,
        transaction_status: status,
        transaction_amount: Number(attempt.amount) * 100,
        transaction_currency_id: 'NGN',
        transaction_type: 'Card',
      },
    });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
});

/* ---------------- helpers ---------------- */

async function product(name: string, stock: Partial<Record<keyof typeof warehouses, number>>) {
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
  for (const [key, quantity] of Object.entries(stock)) {
    await prisma.inventoryLevel.create({
      data: { inventoryItemId: item.id, warehouseId: warehouses[key as keyof typeof warehouses], quantity },
    });
  }
  return item.id;
}

async function order(productId: string, quantity: number, paymentMethodId: 'squad' | 'pod' | 'transfer' = 'pod') {
  const storeConfig = await getStoreCheckoutConfig({ organizationSlug: store.slug });
  return placeOrder({
    organizationSlug: store.slug,
    customerId: null,
    lines: [{ productId, variantId: productId, quantity }],
    contact: CONTACT,
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId,
    note: '',
    config: storeConfig,
  });
}

async function placed(productId: string, quantity: number, paymentMethodId: 'squad' | 'pod' | 'transfer' = 'pod') {
  const result = await order(productId, quantity, paymentMethodId);
  if (!result.ok) throw new Error(result.message);
  return result;
}

async function levels(productId: string) {
  const rows = await prisma.inventoryLevel.findMany({
    where: { inventoryItemId: productId },
    select: { warehouseId: true, quantity: true, reservedQty: true },
  });
  const byStore = (id: string) => {
    const row = rows.find((r) => r.warehouseId === id);
    return row ? { quantity: Number(row.quantity), reserved: Number(row.reservedQty) } : null;
  };
  return { main: byStore(warehouses.main), annex: byStore(warehouses.annex), shopFloor: byStore(warehouses.shopFloor) };
}

const onlineStock = async (productId: string) =>
  (await getProductsByIds([productId], { organizationSlug: store.slug }))[0]?.variants[0]?.stock ?? 0;

const orderRow = (id: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id },
    select: { status: true, paymentStatus: true, paidAt: true, cancelReason: true },
  });

const scope = (orderId: string) => ({ organizationId: store.id, orderId });
const emailsFor = (reference: string) => sentEmails.filter((e) => e.reference === reference).map((e) => e.kind);

async function backdate(orderId: string, minutes = UNPAID_ORDER_HOLD_MINUTES + 5) {
  await prisma.order.update({
    where: { id: orderId },
    data: { placedAt: new Date(Date.now() - minutes * 60_000) },
  });
}

let deliveryMethodId = '';

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Lifecycle Store', slug: store.slug } })).id;
  deliveryMethodId = await giveStoreDelivery(store.id);
  const make = (name: string, sellsOnline: boolean) =>
    prisma.warehouse.create({ data: { organizationId: store.id, name, sellsOnline, status: 'ACTIVE' } });
  warehouses.main = (await make('Main', true)).id;
  warehouses.annex = (await make('Annex', true)).id;
  warehouses.shopFloor = (await make('Shop floor', false)).id;
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  squadVerify.clear();
  sentEmails.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;

  await prisma.orderPayment.deleteMany({ where: { organizationId: store.id } });
  await prisma.merchantBankAccount.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderStockAllocation.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.delete({ where: { id: store.id } });
});

/* ---------------- holding stock ---------------- */

describe('placing an order holds its stock', () => {
  it('holds the units, so the storefront stops offering them', async () => {
    const id = await product('Held', { main: 5 });
    expect(await onlineStock(id)).toBe(5);

    await placed(id, 3);

    expect((await levels(id)).main).toEqual({ quantity: 5, reserved: 3 });
    expect(await onlineStock(id)).toBe(2);
  });

  it('draws from the fullest online store first and spills into the next — never a store that doesn’t sell online', async () => {
    const id = await product('Split', { main: 2, annex: 3, shopFloor: 50 });
    const result = await placed(id, 4);

    expect(await levels(id)).toEqual({
      annex: { quantity: 3, reserved: 3 },
      main: { quantity: 2, reserved: 1 },
      shopFloor: { quantity: 50, reserved: 0 },
    });
    const allocations = await prisma.orderStockAllocation.findMany({ where: { orderId: result.orderId } });
    expect(allocations.map((a) => Number(a.quantity)).sort()).toEqual([1, 3]);
  });

  it('never lets two shoppers both have the last unit', async () => {
    const id = await product('LastOne', { main: 1 });

    const results = await Promise.all([order(id, 1), order(id, 1), order(id, 1)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.code)).toEqual([
      'product-unavailable',
      'product-unavailable',
    ]);
    expect((await levels(id)).main).toEqual({ quantity: 1, reserved: 1 });
    // The losers left nothing behind.
    expect(await prisma.orderLineItem.count({ where: { productId: id } })).toBe(1);
  });

  it('refuses more than is available, and writes no order at all', async () => {
    const id = await product('Short', { main: 2 });
    const result = await order(id, 3);
    expect(result.ok).toBe(false);
    expect(await prisma.orderLineItem.count({ where: { productId: id } })).toBe(0);
    expect((await levels(id)).main).toEqual({ quantity: 2, reserved: 0 });
  });
});

/* ---------------- pay on delivery, end to end ---------------- */

describe('a pay-on-delivery order', () => {
  it('goes from new to delivered and paid, taking the stock out when it ships', async () => {
    const id = await product('Pod', { main: 10 });
    const result = await placed(id, 2, 'pod');

    let row = await orderRow(result.orderId);
    expect(row).toMatchObject({ status: 'PENDING', paymentStatus: 'DUE_ON_DELIVERY' });
    expect(await prisma.orderPayment.count({ where: { orderId: result.orderId } })).toBe(0);

    // Can't ship before it's confirmed.
    expect(await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null })).toMatchObject({ ok: false });

    expect(await confirmOrder(scope(result.orderId))).toEqual({ ok: true });
    expect(await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null })).toEqual({ ok: true });

    expect((await levels(id)).main).toEqual({ quantity: 8, reserved: 0 });
    const out = await prisma.stockMovement.findFirst({
      where: { referenceType: 'Order', referenceId: result.orderId, type: 'OUT' },
    });
    expect(Number(out?.quantity)).toBe(2);

    // Shipped orders can't be cancelled, and shipping twice does nothing.
    expect(await cancelOrder(scope(result.orderId))).toMatchObject({ ok: false });
    expect(await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null })).toMatchObject({ ok: false });
    expect((await levels(id)).main).toEqual({ quantity: 8, reserved: 0 });

    expect(await markOrderDelivered({ ...scope(result.orderId), paymentCollected: true })).toEqual({ ok: true });
    row = await orderRow(result.orderId);
    expect(row).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
    expect(row.paidAt).not.toBeNull();

    expect(emailsFor(result.reference)).toEqual(['shipped', 'delivered']);
  });

  it('can be delivered first and paid later', async () => {
    const id = await product('PodLater', { main: 10 });
    const result = await placed(id, 1, 'pod');
    await confirmOrder(scope(result.orderId));
    await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null });
    await markOrderDelivered({ ...scope(result.orderId), paymentCollected: false });

    expect((await orderRow(result.orderId)).paymentStatus).toBe('DUE_ON_DELIVERY');
    expect(await recordDeliveryPayment(scope(result.orderId))).toEqual({ ok: true });
    expect((await orderRow(result.orderId)).paymentStatus).toBe('PAID');
    expect(await recordDeliveryPayment(scope(result.orderId))).toMatchObject({ ok: false });
  });

  it('gives its stock back when the merchant cancels it', async () => {
    const id = await product('PodCancel', { main: 4 });
    const result = await placed(id, 3, 'pod');
    expect(await onlineStock(id)).toBe(1);

    expect(await cancelOrder(scope(result.orderId))).toEqual({ ok: true });
    expect(await cancelOrder(scope(result.orderId))).toMatchObject({ ok: false });

    expect((await levels(id)).main).toEqual({ quantity: 4, reserved: 0 });
    expect(await onlineStock(id)).toBe(4);
    expect(await orderRow(result.orderId)).toMatchObject({ status: 'CANCELLED', cancelReason: 'merchant' });
    expect(emailsFor(result.reference)).toEqual(['cancelled']);
  });

  it('won’t be touched by another store', async () => {
    const id = await product('Foreign', { main: 4 });
    const result = await placed(id, 1, 'pod');
    expect(await confirmOrder({ organizationId: 'someone-else', orderId: result.orderId })).toEqual({
      ok: false,
      error: 'Order not found',
    });
  });
});

/* ---------------- the stages, and when they happened ---------------- */

describe('the progress track', () => {
  const stamps = (orderId: string) =>
    prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, confirmedAt: true, packingAt: true, shippedAt: true, deliveredAt: true },
    });

  it('moves through packing, stamping each stage as it happens', async () => {
    const id = await product('Stages', { main: 5 });
    const result = await placed(id, 1, 'pod');

    expect(await startPacking(scope(result.orderId))).toMatchObject({ ok: false }); // not confirmed yet
    expect(await stamps(result.orderId)).toMatchObject({ confirmedAt: null, packingAt: null });

    await confirmOrder(scope(result.orderId));
    expect((await stamps(result.orderId)).confirmedAt).not.toBeNull();

    expect(await startPacking(scope(result.orderId))).toEqual({ ok: true });
    expect(await startPacking(scope(result.orderId))).toMatchObject({ ok: false });
    const packing = await stamps(result.orderId);
    expect(packing).toMatchObject({ status: 'PROCESSING', shippedAt: null });
    expect(packing.packingAt).not.toBeNull();

    // Cancelling while packing still gives the stock back.
    const other = await placed(id, 1, 'pod');
    await confirmOrder(scope(other.orderId));
    await startPacking(scope(other.orderId));
    expect(await cancelOrder(scope(other.orderId))).toEqual({ ok: true });

    await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null });
    await markOrderDelivered({ ...scope(result.orderId), paymentCollected: true });
    const done = await stamps(result.orderId);
    expect(done.status).toBe('DELIVERED');
    expect(done.shippedAt).not.toBeNull();
    expect(done.deliveredAt).not.toBeNull();
    expect((await levels(id)).main).toEqual({ quantity: 4, reserved: 0 });
    // No email for packing; one each for shipping, delivery and the other order's cancellation.
    expect(emailsFor(result.reference)).toEqual(['shipped', 'delivered']);
  });

  it('dates each step the order reached, and leaves a skipped step undated', () => {
    const steps = orderTimeline('SHIPPED', '2026-09-17T08:00:00.000Z', {
      confirmedAt: '2026-09-17T09:00:00.000Z',
      packingAt: null, // shipped straight from confirmed
      shippedAt: '2026-09-18T10:00:00.000Z',
      deliveredAt: null,
    });
    expect(steps.map((s) => [s.status, s.at, s.done])).toEqual([
      ['PENDING', '2026-09-17T08:00:00.000Z', true],
      ['CONFIRMED', '2026-09-17T09:00:00.000Z', true],
      ['PROCESSING', null, true],
      ['SHIPPED', '2026-09-18T10:00:00.000Z', true],
      ['DELIVERED', null, false],
    ]);
    expect(steps.find((s) => s.current)?.status).toBe('SHIPPED');
  });

  it('stamps the confirmation time when an online payment confirms the order', async () => {
    const id = await product('StampOnline', { main: 2 });
    const result = await placed(id, 1, 'squad');
    await startOrderPayment({
      organizationId: store.id,
      orderId: result.orderId,
      origin: 'http://shop.test',
      returnPath: '/checkout/confirmation?t=x',
    });
    const attempt = await prisma.orderPayment.findFirstOrThrow({ where: { orderId: result.orderId } });
    squadVerify.set(attempt.reference, 'success');
    await reconcilePayment(attempt.reference);
    expect((await stamps(result.orderId)).confirmedAt).not.toBeNull();
  });
});

/* ---------------- online payment and the hold window ---------------- */

describe('an order paid online', () => {
  async function withPayment(productId: string, quantity: number) {
    const result = await placed(productId, quantity, 'squad');
    await startOrderPayment({
      organizationId: store.id,
      orderId: result.orderId,
      origin: 'http://shop.test',
      returnPath: '/checkout/confirmation?t=x',
    });
    const attempt = await prisma.orderPayment.findFirstOrThrow({ where: { orderId: result.orderId } });
    return { ...result, attemptRef: attempt.reference };
  }

  it('can’t be confirmed or shipped until it’s paid, and is confirmed by paying', async () => {
    const id = await product('Online', { main: 5 });
    const result = await withPayment(id, 1);

    expect(await confirmOrder(scope(result.orderId))).toMatchObject({ ok: false });

    squadVerify.set(result.attemptRef, 'success');
    expect(await reconcilePayment(result.attemptRef)).toBe('paid');
    expect(await orderRow(result.orderId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null })).toEqual({ ok: true });

    expect(emailsFor(result.reference)).toEqual(['payment-received', 'shipped']);
  });

  it('gives its stock back when nobody pays in time — and only then', async () => {
    const id = await product('Abandoned', { main: 3 });
    const stale = await withPayment(id, 2);
    const fresh = await withPayment(id, 1);
    expect(await onlineStock(id)).toBe(0);

    await backdate(stale.orderId);
    const { expired } = await expireUnpaidOrders({ organizationId: store.id });
    expect(expired).toBe(1);

    expect(await orderRow(stale.orderId)).toMatchObject({ status: 'CANCELLED', cancelReason: 'payment-timeout' });
    expect((await orderRow(fresh.orderId)).status).toBe('PENDING');
    expect((await levels(id)).main).toEqual({ quantity: 3, reserved: 1 });
    expect(emailsFor(stale.reference)).toEqual(['payment-timeout']);

    // Running again changes nothing.
    expect((await expireUnpaidOrders({ organizationId: store.id })).expired).toBe(0);
  });

  it('settles instead of expiring when the payment went through unheard', async () => {
    const id = await product('Unheard', { main: 3 });
    const result = await withPayment(id, 1);
    await backdate(result.orderId);
    squadVerify.set(result.attemptRef, 'success');

    expect((await expireUnpaidOrders({ organizationId: store.id })).expired).toBe(0);
    expect(await orderRow(result.orderId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect((await levels(id)).main).toEqual({ quantity: 3, reserved: 1 });
  });

  it('is revived by a late payment when the stock is still there', async () => {
    const id = await product('LateOk', { main: 3 });
    const result = await withPayment(id, 2);
    await backdate(result.orderId);
    await expireUnpaidOrders({ organizationId: store.id });
    expect((await levels(id)).main).toEqual({ quantity: 3, reserved: 0 });

    squadVerify.set(result.attemptRef, 'success');
    expect(await reconcilePayment(result.attemptRef)).toBe('paid');

    expect(await orderRow(result.orderId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', cancelReason: null });
    expect((await levels(id)).main).toEqual({ quantity: 3, reserved: 2 });
    expect(emailsFor(result.reference)).toEqual(['payment-timeout', 'payment-received']);
  });

  it('stays cancelled — but paid, and says so — when the stock sold in the meantime', async () => {
    const id = await product('LateGone', { main: 2 });
    const result = await withPayment(id, 2);
    await backdate(result.orderId);
    await expireUnpaidOrders({ organizationId: store.id });

    await placed(id, 2, 'pod'); // someone else buys it

    squadVerify.set(result.attemptRef, 'success');
    expect(await reconcilePayment(result.attemptRef)).toBe('paid');

    expect(await orderRow(result.orderId)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PAID' });
    expect((await levels(id)).main).toEqual({ quantity: 2, reserved: 2 });
    expect(emailsFor(result.reference)).toEqual(['payment-timeout', 'cancelled']);
  });
});

/* ---------------- bank transfer to the merchant ---------------- */

describe('a bank-transfer order', () => {
  const ACCOUNT = { bankName: 'GTBank', accountName: 'Lifecycle Store Ltd', accountNumber: '0123456789' };

  it('is only offered while the store has an active bank account, and listed last', async () => {
    expect((await getStoreCheckoutConfig({ organizationSlug: store.slug })).paymentMethods.map((m) => m.id)).toEqual([
      'squad',
      'pod',
    ]);
    const id = await product('NoAccount', { main: 3 });
    expect(await order(id, 1, 'transfer')).toMatchObject({ ok: false, code: 'invalid-payment-method' });

    const inactive = await prisma.merchantBankAccount.create({
      data: { organizationId: store.id, ...ACCOUNT, accountNumber: '9999999999', isActive: false },
    });
    expect((await getStoreCheckoutConfig({ organizationSlug: store.slug })).paymentMethods.map((m) => m.id)).not.toContain(
      'transfer',
    );
    await prisma.merchantBankAccount.delete({ where: { id: inactive.id } });

    await prisma.merchantBankAccount.create({ data: { organizationId: store.id, ...ACCOUNT } });
    const config = await getStoreCheckoutConfig({ organizationSlug: store.slug });
    expect(config.paymentMethods.map((m) => m.id)).toEqual(['squad', 'pod', 'transfer']);
    expect(config.transferAccounts).toEqual([ACCOUNT]);
  });

  it('holds stock, keeps the account details it was placed with, and is paid when the merchant confirms', async () => {
    const id = await product('Transfer', { main: 5 });
    const result = await placed(id, 2, 'transfer');

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { status: true, paymentStatus: true, transferDetails: true },
    });
    expect(row).toMatchObject({ status: 'PENDING', paymentStatus: 'AWAITING_TRANSFER', transferDetails: [ACCOUNT] });
    expect((await levels(id)).main).toEqual({ quantity: 5, reserved: 2 });
    expect(await prisma.orderPayment.count({ where: { orderId: result.orderId } })).toBe(0);

    // The merchant editing their account later doesn't rewrite the order.
    await prisma.merchantBankAccount.updateMany({
      where: { organizationId: store.id },
      data: { accountNumber: '1111111111' },
    });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: result.orderId }, select: { transferDetails: true } }))
        .transferDetails,
    ).toEqual([ACCOUNT]);
    await prisma.merchantBankAccount.updateMany({
      where: { organizationId: store.id },
      data: { accountNumber: ACCOUNT.accountNumber },
    });

    // Not confirmable or shippable until the money is confirmed.
    expect(await confirmOrder(scope(result.orderId))).toMatchObject({ ok: false });
    expect(
      await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null }),
    ).toMatchObject({ ok: false });

    expect(await confirmTransferReceived(scope(result.orderId))).toEqual({ ok: true });
    const paid = await orderRow(result.orderId);
    expect(paid).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(paid.paidAt).not.toBeNull();
    expect(await confirmTransferReceived(scope(result.orderId))).toMatchObject({ ok: false });

    expect(
      await markOrderShipped({ ...scope(result.orderId), organizationSlug: store.slug, performedById: null }),
    ).toEqual({ ok: true });
    expect(emailsFor(result.reference)).toEqual(['payment-received', 'shipped']);
  });

  it('gives its stock back after the transfer window, not before', async () => {
    const id = await product('TransferLate', { main: 3 });
    const early = await placed(id, 1, 'transfer');
    const late = await placed(id, 1, 'transfer');

    await backdate(early.orderId, UNPAID_ORDER_HOLD_MINUTES + 5); // past the online window only
    await backdate(late.orderId, TRANSFER_HOLD_HOURS * 60 + 5);
    await expireUnpaidOrders({ organizationId: store.id });

    expect((await orderRow(early.orderId)).status).toBe('PENDING');
    expect(await orderRow(late.orderId)).toMatchObject({ status: 'CANCELLED', cancelReason: 'payment-timeout' });
    expect((await levels(id)).main).toEqual({ quantity: 3, reserved: 1 });
    expect(emailsFor(late.reference)).toEqual(['payment-timeout']);
  });

  it('comes back when a late transfer is confirmed and the stock is still there', async () => {
    const id = await product('TransferRevive', { main: 2 });
    const result = await placed(id, 2, 'transfer');
    await backdate(result.orderId, TRANSFER_HOLD_HOURS * 60 + 5);
    await expireUnpaidOrders({ organizationId: store.id });

    expect(await confirmTransferReceived(scope(result.orderId))).toEqual({ ok: true });
    expect(await orderRow(result.orderId)).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect((await levels(id)).main).toEqual({ quantity: 2, reserved: 2 });
  });

  it('records a late transfer but tells the merchant to refund when the stock has sold', async () => {
    const id = await product('TransferGone', { main: 1 });
    const result = await placed(id, 1, 'transfer');
    await backdate(result.orderId, TRANSFER_HOLD_HOURS * 60 + 5);
    await expireUnpaidOrders({ organizationId: store.id });
    await placed(id, 1, 'pod');

    const outcome = await confirmTransferReceived(scope(result.orderId));
    expect(outcome).toMatchObject({ ok: true, warning: expect.stringMatching(/refund/i) });
    expect(await orderRow(result.orderId)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PAID' });
    expect(emailsFor(result.reference).at(-1)).toBe('cancelled');
  });
});

/* ---------------- the email itself ---------------- */

describe('order emails', () => {
  it('sends to the shopper, in the store’s name, with a link that opens the order', async () => {
    const { sendStorefrontOrderUpdateEmail } = await import('@/lib/email');
    const id = await product('Mail', { main: 3 });
    const result = await placed(id, 1, 'pod');

    await notifyShopper(result.orderId, 'shipped');

    const payload = vi.mocked(sendStorefrontOrderUpdateEmail).mock.calls.at(-1)![0];
    expect(payload).toMatchObject({
      to: CONTACT.email,
      kind: 'shipped',
      storeName: 'Lifecycle Store',
      reference: result.reference,
      firstName: 'Ada',
    });
    expect(payload.orderUrl).toContain(`/checkout/confirmation?t=${encodeURIComponent(result.confirmationToken)}`);
    expect(payload.lines).toEqual([{ name: 'Mail', quantity: 1, total: expect.stringContaining('1,000') }]);
  });

  it('renders every kind without inventing anything', async () => {
    const kinds: OrderEmailKind[] = [
      'placed-pay-on-delivery',
      'placed-bank-transfer',
      'payment-received',
      'shipped',
      'delivered',
      'cancelled',
      'payment-timeout',
    ];
    for (const kind of kinds) {
      const html = await render(
        StorefrontOrderUpdateEmail({
          kind,
          storeName: 'Ada’s Store',
          firstName: 'Ada',
          reference: 'ORD-2026-000009',
          orderUrl: 'https://shop.example/checkout/confirmation?t=abc',
          total: '₦12,500',
          lines: [{ name: 'Tote', quantity: 2, total: '₦10,000' }],
          deliveryLabel: 'Standard delivery',
          address: ['Ada Okoro', '12 Example Street'],
          transferAccounts: [{ bankName: 'GTBank', accountName: 'Ada’s Store Ltd', accountNumber: '0123456789' }],
          transferHoldHours: 48,
        }),
      );
      if (kind === 'placed-bank-transfer') {
        expect(html).toContain('0123456789');
        expect(html).toContain('48 hours');
      }
      expect(html).toContain('ORD-2026-000009');
      expect(html).not.toMatch(/refund (has been|was) issued|out for delivery today/i);
    }
  });
});
