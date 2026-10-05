/*
 * Paying for an order through Paystack (ROADMAP 10.4), against the real
 * database.
 *
 * Paystack is stubbed at `fetch`, so these tests
 * prove OUR side of the contract: an order becomes PAID only because the
 * provider's verify endpoint said so — for the amount we asked for, to the
 * shop's own subaccount, with nothing for the platform — exactly once,
 * whichever door (callback, webhook, confirmation page) asks first, and
 * however often.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { placeOrder } from '@/lib/storefront/orders/create';
import {
  getOrderPaymentState,
  reconcilePayment,
  startOrderPayment,
} from '@/lib/storefront/checkout/payment-service';
/* Emails are proved in tests/storefront-order-lifecycle.test.ts; never send real ones. */
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendLowStockAlertEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
}));

import { GET as callback } from '@/app/api/payments/paystack/callback/route';
import type { CheckoutAddress, CheckoutConfig, CheckoutContact } from '@/lib/storefront/checkout/types';

const PAYSTACK_SECRET = 'sk_test_secret_for_vitest';
const envWas = {
  paystack: process.env.PAYSTACK_SECRET_KEY,
  fixtures: process.env.STOREFRONT_FIXTURES,
};
process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET;
process.env.STOREFRONT_FIXTURES = '0';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-payments-${suffix}` };
const SUBACCOUNT = `ACCT_store_${suffix}`;
let productId = '';
let config: CheckoutConfig;

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
  country: 'NG',
  state: 'Rivers',
  city: 'Port Harcourt',
  addressLine1: '12 Example Street',
  addressLine2: '',
  postalCode: '',
};

/* ---------------- a fake Paystack ---------------- */

type Verify =
  | {
      status: string;
      amount?: number;
      currency?: string;
      /** which subaccount Paystack says got the money — defaults to the shop's */
      subaccount?: string | null;
      /** the platform's share in kobo — defaults to 0 */
      platform?: number;
    }
  | 'unknown';

const paystack = {
  initialized: [] as Record<string, unknown>[],
  verify: new Map<string, Verify>(),
  failInitialize: false,
};

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (url.startsWith('https://api.paystack.co/transaction/initialize')) {
    if (paystack.failInitialize) return json(500, { status: false, message: 'down' });
    const body = JSON.parse(String(init?.body));
    paystack.initialized.push(body);
    return json(200, {
      status: true,
      message: 'Authorization URL created',
      data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, reference: body.reference },
    });
  }

  const paystackVerify = url.match(/^https:\/\/api\.paystack\.co\/transaction\/verify\/(.+)$/);
  if (paystackVerify) {
    const ref = decodeURIComponent(paystackVerify[1]);
    const answer = paystack.verify.get(ref);
    if (!answer || answer === 'unknown') return json(400, { status: false, message: 'Transaction reference not found.' });
    const attempt = await prisma.orderPayment.findUnique({ where: { reference: ref } });
    const amount = answer.amount ?? Number(attempt!.amount) * 100;
    const fee = 250_00;
    const platform = answer.platform ?? 0;
    return json(200, {
      status: true,
      data: {
        id: 900_000_001,
        reference: ref,
        status: answer.status,
        amount,
        currency: answer.currency ?? 'NGN',
        channel: 'card',
        subaccount: answer.subaccount === null ? {} : { subaccount_code: answer.subaccount ?? SUBACCOUNT },
        fees_split: { paystack: fee, integration: platform, subaccount: amount - fee - platform },
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
    paymentMethodId: 'paystack',
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

const setSetup = (setupStatus: 'ACTIVE' | 'DISABLED') =>
  prisma.merchantPaymentAccount.update({ where: { organizationId: store.id }, data: { setupStatus } });

let deliveryMethodId = '';

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Payments Store', slug: store.slug } })).id;
  const warehouse = await prisma.warehouse.create({
    data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' },
  });
  deliveryMethodId = await giveStoreDelivery(store.id);
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
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 200 } });
  productId = item.id;

  // A shop that may take online payments: verified by us, subaccount active.
  await prisma.merchantPaymentAccount.create({
    data: {
      organizationId: store.id,
      businessName: 'Payments Store',
      verificationStatus: 'VERIFIED',
      setupStatus: 'ACTIVE',
      paystackSubaccountCode: SUBACCOUNT,
    },
  });
  config = await getStoreCheckoutConfig({ organizationSlug: store.slug });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  paystack.initialized = [];
  paystack.verify.clear();
  paystack.failInitialize = false;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore('PAYSTACK_SECRET_KEY', envWas.paystack);
  restore('STOREFRONT_FIXTURES', envWas.fixtures);

  await prisma.orderPayment.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.delete({ where: { id: store.id } });
});

/* ---------------- offering it ---------------- */

describe('offering online payment', () => {
  it('offers "Pay online" through Paystack first — only to a shop that may take it', async () => {
    expect(config.paymentMethods[0]).toMatchObject({ id: 'paystack', provider: 'paystack' });

    await setSetup('DISABLED');
    try {
      const off = await getStoreCheckoutConfig({ organizationSlug: store.slug });
      expect(off.paymentMethods.map((m) => m.id)).not.toContain('paystack');
    } finally {
      await setSetup('ACTIVE');
    }
  });
});

/* ---------------- starting ---------------- */

describe('starting a payment', () => {
  it('asks Paystack for the total in kobo, to the shop’s own subaccount, with the merchant paying the fee and nothing for the platform', async () => {
    const order = await newOrder();
    const { started, attempt } = await startPayment(order.orderId);

    expect(started).toEqual({ ok: true, checkoutUrl: `https://checkout.paystack.com/${attempt.reference}` });

    const sent = paystack.initialized[0];
    const total = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, select: { totalAmount: true } });
    expect(sent).toMatchObject({
      amount: Number(total.totalAmount) * 100,
      currency: 'NGN',
      email: CONTACT.email,
      reference: attempt.reference,
      subaccount: SUBACCOUNT,
      bearer: 'subaccount',
      transaction_charge: 0,
      metadata: { purpose: 'storefront-order', organizationId: store.id, orderId: order.orderId, attemptId: attempt.id },
    });
    expect(attempt).toMatchObject({ provider: 'paystack', subaccountCode: SUBACCOUNT });
    expect(attempt.reference.startsWith(order.reference)).toBe(true);
    expect(sent.callback_url).toBe(
      `http://shop.pay.app.localhost:3000/api/payments/paystack/callback?ref=${encodeURIComponent(attempt.reference)}`,
    );
    expect(attempt.returnUrl).toBe('http://shop.pay.app.localhost:3000/checkout/confirmation?t=tok');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
  });

  it('won’t start one for a shop that can no longer take online payments', async () => {
    const order = await newOrder();
    await setSetup('DISABLED');
    try {
      const started = await startOrderPayment({
        organizationId: store.id,
        orderId: order.orderId,
        origin: 'http://shop.pay.app.localhost:3000',
        returnPath: '/checkout/confirmation?t=tok',
      });
      expect(started).toEqual({ ok: false, reason: 'unavailable' });
      expect(paystack.initialized).toHaveLength(0);
    } finally {
      await setSetup('ACTIVE');
    }
  });

  it('keeps the order, and says so, when Paystack is unreachable', async () => {
    paystack.failInitialize = true;
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
  it('marks the order paid and confirmed only after Paystack verifies it — once — and keeps Paystack’s split', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);

    // Nothing from Paystack yet: nothing changes.
    expect(await reconcilePayment(attempt.reference)).toBe('pending');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');

    // Still in progress on Paystack's page.
    paystack.verify.set(attempt.reference, { status: 'ongoing' });
    expect(await reconcilePayment(attempt.reference)).toBe('pending');

    paystack.verify.set(attempt.reference, { status: 'success' });
    const [a, b] = await Promise.all([reconcilePayment(attempt.reference), reconcilePayment(attempt.reference)]);
    expect([a, b].sort()).toEqual(['already-paid', 'paid']);

    const row = await orderRow(order.orderId);
    expect(row.paymentStatus).toBe('PAID');
    expect(row.status).toBe('CONFIRMED');
    expect(row.paidAt).not.toBeNull();

    const settled = await prisma.orderPayment.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(settled.status).toBe('SUCCESS');
    expect(settled.channel).toBe('card');
    expect(settled.gatewayRef).toBe('900000001');
    // As Paystack reported it: the merchant's share, nothing for the platform, the fee.
    expect(Number(settled.feeAmount)).toBe(250);
    expect(Number(settled.platformAmount)).toBe(0);
    expect(Number(settled.merchantAmount)).toBe(Number(settled.amount) - 250);

    expect(await getOrderPaymentState(order.orderId)).toEqual({
      canPay: false,
      lastAttemptFailed: false,
      cancelReason: null,
    });
  });

  it('refuses a payment for a different amount', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    paystack.verify.set(attempt.reference, { status: 'success', amount: 100 });

    expect(await reconcilePayment(attempt.reference)).toBe('mismatch');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
    expect((await prisma.orderPayment.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('MISMATCH');
  });

  it('refuses a payment in a different currency', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    paystack.verify.set(attempt.reference, { status: 'success', currency: 'USD' });

    expect(await reconcilePayment(attempt.reference)).toBe('mismatch');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
  });

  it('refuses a payment that went to another subaccount, or to none', async () => {
    for (const subaccount of ['ACCT_somebody_else', null]) {
      const order = await newOrder();
      const { attempt } = await startPayment(order.orderId);
      paystack.verify.set(attempt.reference, { status: 'success', subaccount });
      expect(await reconcilePayment(attempt.reference)).toBe('mismatch');
      expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
    }
  });

  it('refuses a payment that gave the platform a share', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    paystack.verify.set(attempt.reference, { status: 'success', platform: 500_00 });
    expect(await reconcilePayment(attempt.reference)).toBe('mismatch');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
  });

  it('lets the shopper try again after abandoning the payment page', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    paystack.verify.set(attempt.reference, { status: 'abandoned' });

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
    paystack.verify.set(attempt.reference, { status: 'success' });

    // The webhook never arrived; the shopper presses "Pay now" again.
    const again = await startOrderPayment({
      organizationId: store.id,
      orderId: order.orderId,
      origin: 'http://shop.pay.app.localhost:3000',
      returnPath: '/checkout/confirmation?t=tok',
    });
    expect(again).toEqual({ ok: false, reason: 'already-paid' });
    expect((await orderRow(order.orderId)).paymentStatus).toBe('PAID');
    expect(paystack.initialized).toHaveLength(1);
  });

  it('ignores references that aren’t ours', async () => {
    expect(await reconcilePayment('NOT-OURS-123')).toBe('unknown-reference');
  });
});

/* ---------------- the return route ---------------- */

describe('the Paystack callback', () => {
  it('verifies, then returns the shopper to the stored address — not one from the URL', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    paystack.verify.set(attempt.reference, { status: 'success' });

    const res = await callback(
      new NextRequest(
        `http://shop.pay.app.localhost:3000/api/payments/paystack/callback?ref=${attempt.reference}&returnUrl=https://evil.example`,
      ),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://shop.pay.app.localhost:3000/checkout/confirmation?t=tok');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('PAID');
  });

  it('copes with Paystack appending trxref and reference to ours', async () => {
    const order = await newOrder();
    const { attempt } = await startPayment(order.orderId);
    paystack.verify.set(attempt.reference, { status: 'success' });

    await callback(
      new NextRequest(
        `http://shop.pay.app.localhost:3000/api/payments/paystack/callback?ref=${attempt.reference}&trxref=${attempt.reference}&reference=${attempt.reference}`,
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
    paystack.verify.set(attempt.reference, { status: 'success' });

    const res = await callback(
      new NextRequest(`http://m.app.localhost:3000/api/payments/paystack/callback?ref=${attempt.reference}`),
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`com.mansaas.app://payment-return?ref=${encodeURIComponent(attempt.reference)}`);
    expect(html).toContain('Payment received');
    expect((await orderRow(order.orderId)).paymentStatus).toBe('PAID');
  });

  it("hands a payment from a store's own app back to that app, not the shared one (16.1)", async () => {
    const order = await newOrder();
    await startOrderPayment({
      organizationId: store.id,
      orderId: order.orderId,
      origin: 'http://m.app.localhost:3000',
      returnPath: '/s/pay/checkout/confirmation?t=tok',
      nativeApp: true,
      nativeAppScheme: 'com.pay.shop',
    });
    const attempt = await prisma.orderPayment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(attempt.nativeAppScheme).toBe('com.pay.shop');
    paystack.verify.set(attempt.reference, { status: 'success' });

    const res = await callback(
      new NextRequest(`http://m.app.localhost:3000/api/payments/paystack/callback?ref=${attempt.reference}`),
    );
    const html = await res.text();
    expect(html).toContain(`com.pay.shop://payment-return?ref=${encodeURIComponent(attempt.reference)}`);
    expect(html).not.toContain('com.mansaas.app://');
  });

  it('never records an app scheme for a payment from the web', async () => {
    const order = await newOrder();
    await startOrderPayment({
      organizationId: store.id,
      orderId: order.orderId,
      origin: 'http://shop.pay.app.localhost:3000',
      returnPath: '/checkout/confirmation?t=tok',
      nativeApp: false,
      nativeAppScheme: 'com.pay.shop',
    });
    const attempt = await prisma.orderPayment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(attempt.nativeAppScheme).toBeNull();
  });

  it('sends an unknown reference home', async () => {
    const res = await callback(new NextRequest('http://shop.pay.app.localhost:3000/api/payments/paystack/callback?ref=nope'));
    expect(res.headers.get('location')).toBe('http://shop.pay.app.localhost:3000/');
  });
});

/* ---------------- history: attempts started on Squad (ROADMAP 10.9) ---------------- */

describe('attempts started on Squad, before it was retired', () => {
  it('are answered as unverifiable without calling anyone, and never change the order', async () => {
    const order = await newOrder();
    const attempt = await prisma.orderPayment.create({
      data: {
        organizationId: store.id,
        orderId: order.orderId,
        provider: 'squad',
        reference: `${order.reference}-LEGACY-${Math.random().toString(36).slice(2, 7)}`,
        amount: (await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).totalAmount,
        currency: 'NGN',
        returnUrl: 'http://shop.pay.app.localhost:3000/checkout/confirmation?t=tok',
      },
    });

    expect(await reconcilePayment(attempt.reference)).toBe('unverifiable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await orderRow(order.orderId)).paymentStatus).toBe('AWAITING_PAYMENT');
    expect((await prisma.orderPayment.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('PENDING');
  });
});
