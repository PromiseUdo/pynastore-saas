/*
 * Paying for an order through Squad, against the real database.
 *
 * Squad itself is stubbed at `fetch`, so these tests prove OUR side of the
 * contract: an order becomes PAID only because Squad's verify endpoint said
 * so, for the amount we asked for, exactly once — whichever door (callback,
 * webhook, confirmation page) asks first, and however often.
 */
import crypto from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { placeOrder } from '@/lib/storefront/orders/create';
import {
  getOrderPaymentState,
  reconcilePayment,
  startOrderPayment,
} from '@/lib/storefront/checkout/payment-service';
import { squadBaseUrl, verifyWebhookSignature, webhookTransactionRef } from '@/lib/payments/squad';
/* Emails are proved in tests/storefront-order-lifecycle.test.ts; never send real ones. */
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendLowStockAlertEmail: vi.fn(async () => {}),
}));

import { GET as callback } from '@/app/api/payments/squad/callback/route';
import { POST as webhook } from '@/app/api/payments/squad/webhook/route';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';

const SECRET = 'sandbox_sk_test_secret_for_vitest';
const keyWas = process.env.SQUADCO_SECRET_KEY;
process.env.SQUADCO_SECRET_KEY = SECRET;

const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-payments-${suffix}` };
let productId = '';

const config = await getCheckoutConfig({ organizationSlug: 'demo' });

const CONTACT: CheckoutContact = {
  firstName: 'Ada',
  lastName: 'Okoro',
  email: `ada-pay-${suffix}@example.com`,
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

type Verify = { status: string; amount?: number; currency?: string } | 'unknown';

const squad = {
  initiated: [] as Record<string, unknown>[],
  verify: new Map<string, Verify>(),
  failInitiate: false,
};

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (url.endsWith('/transaction/initiate')) {
    if (squad.failInitiate) return json(500, { success: false, message: 'down', data: {} });
    const body = JSON.parse(String(init?.body));
    squad.initiated.push(body);
    return json(200, {
      success: true,
      data: { checkout_url: `https://sandbox-pay.squadco.com/c_${body.transaction_ref}`, transaction_ref: body.transaction_ref },
    });
  }

  const verify = url.match(/\/transaction\/verify\/(.+)$/);
  if (verify) {
    const ref = decodeURIComponent(verify[1]);
    const answer = squad.verify.get(ref);
    if (!answer || answer === 'unknown') return json(400, { success: false, message: 'Invalid', data: null });
    const attempt = await prisma.orderPayment.findUnique({ where: { reference: ref } });
    return json(200, {
      success: true,
      data: {
        transaction_ref: ref,
        transaction_status: answer.status,
        transaction_amount: answer.amount ?? Number(attempt!.amount) * 100,
        transaction_currency_id: answer.currency ?? 'NGN',
        transaction_type: 'Card',
        email: CONTACT.email,
      },
    });
  }

  throw new Error(`Unexpected fetch in test: ${url}`);
});

/* ---------------- setup ---------------- */

async function newOrder() {
  const result = await placeOrder({
    organizationSlug: store.slug,
    customerId: null,
    lines: [{ productId, variantId: productId, quantity: 2 }],
    contact: CONTACT,
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId: 'squad',
    note: '',
    config,
  });
  if (!result.ok) throw new Error(`could not place order: ${result.message}`);
  return result;
}

async function startPayment(orderId: string) {
  const started = await startOrderPayment({
    organizationId: store.id,
    orderId,
    origin: 'http://shop.pay.app.localhost:3000',
    returnPath: '/checkout/confirmation?t=tok',
  });
  const attempt = await prisma.orderPayment.findFirstOrThrow({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });
  return { started, attempt };
}

const orderRow = (id: string) =>
  prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true, paymentStatus: true, paidAt: true } });

let deliveryMethodId = '';

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Payments Store', slug: store.slug } })).id;
  deliveryMethodId = await giveStoreDelivery(store.id);

  const warehouse = await prisma.warehouse.create({
    data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' },
  });
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId: store.id,
      name: 'Tote',
      sku: `TOTE-${suffix}`.slice(0, 40),
      slug: `tote-${suffix}`.slice(0, 60),
      sellingPrice: 5000,
      isPublished: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 50 } });
  productId = item.id;
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  squad.initiated = [];
  squad.verify.clear();
  squad.failInitiate = false;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (keyWas === undefined) delete process.env.SQUADCO_SECRET_KEY;
  else process.env.SQUADCO_SECRET_KEY = keyWas;
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;

  await prisma.orderPayment.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.delete({ where: { id: store.id } });
});

/* ---------------- the client ---------------- */

describe('Squad client', () => {
  it('talks to the sandbox with a sandbox key', () => {
    expect(squadBaseUrl()).toBe('https://sandbox-api-d.squadco.com');
  });

  it('accepts only a webhook signed with our secret', () => {
    const body = JSON.stringify({ Event: 'charge_successful', TransactionRef: 'X' });
    const signature = crypto.createHmac('sha512', SECRET).update(body).digest('hex').toUpperCase();

    expect(verifyWebhookSignature(body, signature)).toBe(true);
    expect(verifyWebhookSignature(body, signature.toLowerCase())).toBe(true);
    expect(verifyWebhookSignature(`${body} `, signature)).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
    expect(verifyWebhookSignature(body, 'nope')).toBe(false);
  });

  it('finds the reference wherever the webhook put it', () => {
    expect(webhookTransactionRef({ TransactionRef: 'A' })).toBe('A');
    expect(webhookTransactionRef({ Body: { transaction_ref: 'B' } })).toBe('B');
    expect(webhookTransactionRef({ nothing: true })).toBeNull();
  });
});

/* ---------------- starting ---------------- */

describe('starting a payment', () => {
  it('asks Squad for the order total in kobo and returns its page', async () => {
    const order = await newOrder();
    const { started, attempt } = await startPayment(order.orderId);

    expect(started).toEqual({ ok: true, checkoutUrl: `https://sandbox-pay.squadco.com/c_${attempt.reference}` });

    const sent = squad.initiated[0];
    const total = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, select: { totalAmount: true } });
    expect(sent.amount).toBe(Number(total.totalAmount) * 100);
    expect(sent.currency).toBe('NGN');
    expect(sent.email).toBe(CONTACT.email);
    expect(sent.transaction_ref).toBe(attempt.reference);
    expect(attempt.reference.startsWith(order.reference)).toBe(true);
    expect(sent.callback_url).toBe(
      `http://shop.pay.app.localhost:3000/api/payments/squad/callback?ref=${encodeURIComponent(attempt.reference)}`,
    );
    expect(attempt.returnUrl).toBe('http://shop.pay.app.localhost:3000/checkout/confirmation?t=tok');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
  });

  it('keeps the order, and says so, when Squad is unreachable', async () => {
    squad.failInitiate = true;
    const order = await newOrder();
    const { started, attempt } = await startPayment(order.orderId);

    expect(started).toEqual({ ok: false, reason: 'unavailable' });
    expect(attempt.status).toBe('FAILED');
    expect((await getOrderPaymentState(order.orderId)).canPay).toBe(true);
  });

  it('gives every attempt its own reference', async () => {
    const order = await newOrder();
    const first = await startPayment(order.orderId);
    const second = await startPayment(order.orderId);
    expect(first.attempt.reference).not.toBe(second.attempt.reference);
  });
});

/* ---------------- settling ---------------- */

describe('settling a payment', () => {
  it('marks the order paid and confirmed only after Squad verifies it — once', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);

    // Nothing from Squad yet: nothing changes.
    expect(await reconcilePayment(attempt.reference)).toBe('pending');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');

    squad.verify.set(attempt.reference, { status: 'Success' });
    const [a, b] = await Promise.all([reconcilePayment(attempt.reference), reconcilePayment(attempt.reference)]);
    expect([a, b].sort()).toEqual(['already-paid', 'paid']);

    const row = await orderRow(order.orderId);
    expect(row.paymentStatus).toBe('PAID');
    expect(row.status).toBe('CONFIRMED');
    expect(row.paidAt).not.toBeNull();

    const settled = await prisma.orderPayment.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(settled.status).toBe('SUCCESS');
    expect(settled.channel).toBe('Card');

    expect(await getOrderPaymentState(order.orderId)).toEqual({
      canPay: false,
      lastAttemptFailed: false,
      cancelReason: null,
    });
  });

  it('refuses a payment for a different amount', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    squad.verify.set(attempt.reference, { status: 'success', amount: 100 });

    expect(await reconcilePayment(attempt.reference)).toBe('mismatch');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
    expect((await prisma.orderPayment.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('MISMATCH');
  });

  it('refuses a payment in a different currency', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    squad.verify.set(attempt.reference, { status: 'success', currency: 'USD' });

    expect(await reconcilePayment(attempt.reference)).toBe('mismatch');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
  });

  it('lets the shopper try again after abandoning the payment page', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    squad.verify.set(attempt.reference, { status: 'Abandoned' });

    expect(await reconcilePayment(attempt.reference)).toBe('failed');
    expect(await getOrderPaymentState(order.orderId)).toEqual({
      canPay: true,
      lastAttemptFailed: true,
      cancelReason: null,
    });
  });

  it('won’t start a second payment for an order an earlier attempt already paid', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    squad.verify.set(attempt.reference, { status: 'success' });

    // The webhook never arrived; the shopper presses "Pay now" again.
    const again = await startOrderPayment({
      organizationId: store.id,
      orderId: order.orderId,
      origin: 'http://shop.pay.app.localhost:3000',
      returnPath: '/checkout/confirmation?t=tok',
    });
    expect(again).toEqual({ ok: false, reason: 'already-paid' });
    expect((await orderRow(order.orderId)).paymentStatus).toBe('PAID');
    expect(squad.initiated).toHaveLength(1);
  });

  it('ignores references that aren’t ours', async () => {
    expect(await reconcilePayment('NOT-OURS-123')).toBe('unknown-reference');
  });
});

/* ---------------- the routes ---------------- */

describe('the callback', () => {
  it('verifies, then returns the shopper to the stored address — not one from the URL', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    squad.verify.set(attempt.reference, { status: 'success' });

    const res = await callback(
      new NextRequest(
        `http://shop.pay.app.localhost:3000/api/payments/squad/callback?ref=${attempt.reference}&returnUrl=https://evil.example`,
      ),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://shop.pay.app.localhost:3000/checkout/confirmation?t=tok');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('PAID');
  });

  it('copes with Squad appending its own query to ours', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    squad.verify.set(attempt.reference, { status: 'success' });

    await callback(
      new NextRequest(
        `http://shop.pay.app.localhost:3000/api/payments/squad/callback?ref=${attempt.reference}?reference=${attempt.reference}`,
      ),
    );
    expect((await orderRow(order.orderId)).paymentStatus).toBe('PAID');
  });

  it('hands a payment started in the phone app back to the app by deep link', async () => {
    const order = await newOrder();
    await startOrderPayment({
      organizationId: store.id,
      orderId: order.orderId,
      origin: 'http://m.app.localhost:3000',
      returnPath: '/s/pay/checkout/confirmation?t=tok',
      nativeApp: true,
    });
    const attempt = await prisma.orderPayment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(attempt.nativeApp).toBe(true);
    squad.verify.set(attempt.reference, { status: 'success' });

    const res = await callback(
      new NextRequest(`http://m.app.localhost:3000/api/payments/squad/callback?ref=${attempt.reference}`),
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`com.mansaas.app://payment-return?ref=${encodeURIComponent(attempt.reference)}`);
    expect(html).toContain('Payment received');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('PAID');
  });

  it('sends an unknown reference home', async () => {
    const res = await callback(new NextRequest('http://shop.pay.app.localhost:3000/api/payments/squad/callback?ref=nope'));
    expect(res.headers.get('location')).toBe('http://shop.pay.app.localhost:3000/');
  });
});

describe('the webhook', () => {
  const post = (body: string, signature: string | null) =>
    webhook(
      new NextRequest('https://tunnel.example/api/payments/squad/webhook', {
        method: 'POST',
        body,
        headers: signature ? { 'x-squad-encrypted-body': signature } : {},
      }),
    );
  const sign = (body: string) => crypto.createHmac('sha512', SECRET).update(body).digest('hex').toUpperCase();

  it('rejects an unsigned or wrongly signed request without touching the order', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    squad.verify.set(attempt.reference, { status: 'success' });
    const body = JSON.stringify({ Event: 'charge_successful', TransactionRef: attempt.reference });

    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, sign('something else'))).status).toBe(401);
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
  });

  it('settles a signed notification by verifying with Squad, not by believing the body', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);

    // The body claims success; Squad's verify endpoint says otherwise.
    squad.verify.set(attempt.reference, { status: 'failed' });
    const body = JSON.stringify({
      Event: 'charge_successful',
      TransactionRef: attempt.reference,
      Body: { transaction_ref: attempt.reference, transaction_status: 'Success' },
    });
    expect((await post(body, sign(body))).status).toBe(200);
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');

    // A real success, delivered twice.
    const order2 = await newOrder();
    const { attempt: attempt2 } = await startPayment(order2.orderId);
    squad.verify.set(attempt2.reference, { status: 'success' });
    const body2 = JSON.stringify({ Event: 'charge_successful', TransactionRef: attempt2.reference });
    expect((await post(body2, sign(body2))).status).toBe(200);
    expect((await post(body2, sign(body2))).status).toBe(200);
    expect((await orderRow(order2.orderId)).paymentStatus).toBe('PAID');
  });
});
