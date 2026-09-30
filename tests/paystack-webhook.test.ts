/*
 * The platform's one Paystack webhook (ROADMAP 10.5), against the real
 * database. Paystack's API is stubbed at `fetch`; subscription billing is
 * spied on, so what's proved here is the ROUTING and the storefront/dispute
 * side — billing's own behaviour is unchanged code.
 */
import crypto from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';

const billing = vi.hoisted(() => ({ events: [] as { event: string; data: Record<string, unknown> }[] }));
vi.mock('@/lib/billing/webhook-events', () => ({
  handleBillingEvent: async (event: string, data: Record<string, unknown>) => {
    billing.events.push({ event, data });
  },
}));

const disputeEmails = vi.hoisted(() => [] as { to: string[]; kind: string; reference: string; dueDate: string | null }[]);
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendLowStockAlertEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
  sendPaymentDisputeEmail: async (payload: { to: string[]; kind: string; reference: string; dueDate: string | null }) => {
    disputeEmails.push(payload);
  },
}));

const SECRET = 'sk_test_webhook_secret_for_vitest';
const envWas = { key: process.env.PAYSTACK_SECRET_KEY, fixtures: process.env.STOREFRONT_FIXTURES, admin: process.env.PLATFORM_ADMIN_EMAIL };
process.env.PAYSTACK_SECRET_KEY = SECRET;
process.env.STOREFRONT_FIXTURES = '0';
process.env.PLATFORM_ADMIN_EMAIL = 'platform@example.com';

const { verifyPaystackSignature } = await import('@/lib/payments/paystack');
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { placeOrder } = await import('@/lib/storefront/orders/create');
const { startOrderPayment } = await import('@/lib/storefront/checkout/payment-service');
const { POST: webhook } = await import('@/app/api/payments/paystack/webhook/route');
const { POST: billingWebhook } = await import('@/app/api/billing/paystack/webhook/route');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-webhook-${suffix}` };
const SUBACCOUNT = `ACCT_webhook_${suffix}`;
let productId = '';
let deliveryMethodId = '';
let ownerUserId = '';

/* ---------------- a fake Paystack ---------------- */

const verifyAnswers = new Map<string, string>();
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://api.paystack.co/transaction/initialize')) {
    const body = JSON.parse(String(init?.body));
    return json(200, { status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}` } });
  }
  const verify = url.match(/^https:\/\/api\.paystack\.co\/transaction\/verify\/(.+)$/);
  if (verify) {
    const ref = decodeURIComponent(verify[1]);
    const status = verifyAnswers.get(ref);
    if (!status) return json(400, { status: false, message: 'Transaction reference not found.' });
    const attempt = await prisma.orderPayment.findUniqueOrThrow({ where: { reference: ref } });
    const amount = Number(attempt.amount) * 100;
    return json(200, {
      status: true,
      data: {
        id: 7,
        reference: ref,
        status,
        amount,
        currency: 'NGN',
        channel: 'card',
        subaccount: { subaccount_code: SUBACCOUNT },
        fees_split: { paystack: 100, integration: 0, subaccount: amount - 100 },
      },
    });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
});

/* ---------------- helpers ---------------- */

const sign = (body: string) => crypto.createHmac('sha512', SECRET).update(body).digest('hex');
const post = (body: string, signature: string | null, route = webhook) =>
  route(
    new NextRequest('https://app.example/api/payments/paystack/webhook', {
      method: 'POST',
      body,
      headers: signature ? { 'x-paystack-signature': signature } : {},
    }),
  );
const send = (event: string, data: Record<string, unknown>, route = webhook) => {
  const body = JSON.stringify({ event, data });
  return post(body, sign(body), route);
};

async function paidOrderAttempt() {
  const config = await getStoreCheckoutConfig({ organizationSlug: store.slug });
  const placed = await placeOrder({
    organizationSlug: store.slug,
    customerId: null,
    lines: [{ productId, variantId: productId, quantity: 1 }],
    contact: { firstName: 'Ada', lastName: 'Obi', email: `ada-wh-${suffix}@example.com`, phone: '08012345678' },
    address: {
      firstName: 'Ada',
      lastName: 'Obi',
      phone: '08012345678',
      country: 'NG',
      state: 'Rivers',
      city: 'Port Harcourt',
      addressLine1: '1 Test Road',
      addressLine2: '',
      postalCode: '',
    },
    deliveryMethodId,
    paymentMethodId: 'paystack',
    note: '',
    config,
  });
  if (!placed.ok) throw new Error(placed.message);
  await startOrderPayment({ organizationId: store.id, orderId: placed.orderId, origin: 'https://shop.example', returnPath: '/c' });
  const attempt = await prisma.orderPayment.findFirstOrThrow({ where: { orderId: placed.orderId } });
  return { orderId: placed.orderId, reference: placed.reference, attempt };
}

const orderPaid = async (orderId: string) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } })).paymentStatus;

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Webhook Store', slug: store.slug } })).id;
  const warehouse = await prisma.warehouse.create({ data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' } });
  deliveryMethodId = await giveStoreDelivery(store.id);
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId: store.id,
      name: 'Mug',
      sku: `MUG-${suffix}`.slice(0, 40),
      slug: `mug-${suffix}`.slice(0, 60),
      sellingPrice: 3000,
      isPublished: true,
      status: 'ACTIVE',
    },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 100 } });
  productId = item.id;
  await prisma.merchantPaymentAccount.create({
    data: { organizationId: store.id, businessName: 'Webhook Store', verificationStatus: 'VERIFIED', setupStatus: 'ACTIVE', paystackSubaccountCode: SUBACCOUNT },
  });
  // An Owner, who is told about chargebacks.
  const owner = await prisma.role.create({ data: { organizationId: store.id, name: 'Owner', isSystem: true } });
  ownerUserId = (await prisma.user.create({ data: { name: 'Owner', email: `owner-wh-${suffix}@example.com` } })).id;
  await prisma.membership.create({ data: { userId: ownerUserId, organizationId: store.id, roleId: owner.id, status: 'ACTIVE' } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  verifyAnswers.clear();
  billing.events.length = 0;
  disputeEmails.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore('PAYSTACK_SECRET_KEY', envWas.key);
  restore('STOREFRONT_FIXTURES', envWas.fixtures);
  restore('PLATFORM_ADMIN_EMAIL', envWas.admin);

  await prisma.auditLog.deleteMany({ where: { organizationId: store.id } });
  await prisma.paymentDispute.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderPayment.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId: store.id } });
  await prisma.membership.deleteMany({ where: { organizationId: store.id } });
  await prisma.role.deleteMany({ where: { organizationId: store.id } });
  await prisma.user.delete({ where: { id: ownerUserId } });
  await prisma.organization.delete({ where: { id: store.id } });
});

/* ---------------- the signature ---------------- */

describe('the signature', () => {
  it('accepts only an HMAC of the exact body, made with our secret', () => {
    const body = '{"event":"charge.success"}';
    expect(verifyPaystackSignature(body, sign(body))).toBe(true);
    expect(verifyPaystackSignature(body, sign(body).toUpperCase())).toBe(true);
    expect(verifyPaystackSignature(`${body} `, sign(body))).toBe(false);
    expect(verifyPaystackSignature(body, crypto.createHmac('sha512', 'other').update(body).digest('hex'))).toBe(false);
    expect(verifyPaystackSignature(body, 'short')).toBe(false);
    expect(verifyPaystackSignature(body, null)).toBe(false);
  });

  it('rejects an unsigned or wrongly signed delivery without touching anything', async () => {
    const { orderId, attempt } = await paidOrderAttempt();
    verifyAnswers.set(attempt.reference, 'success');
    const body = JSON.stringify({ event: 'charge.success', data: { reference: attempt.reference } });

    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, sign('something else'))).status).toBe(401);
    expect(await orderPaid(orderId)).toBe('AWAITING_PAYMENT');
    expect(billing.events).toHaveLength(0);
  });

  it('refuses a signed body that isn’t JSON', async () => {
    expect((await post('not json', sign('not json'))).status).toBe(400);
  });
});

/* ---------------- routing ---------------- */

describe('storefront payments', () => {
  it('settle by asking Paystack, not by believing the body', async () => {
    const { orderId, attempt } = await paidOrderAttempt();
    // The body says success; Paystack's verify says it failed.
    verifyAnswers.set(attempt.reference, 'failed');
    expect((await send('charge.success', { reference: attempt.reference, status: 'success' })).status).toBe(200);
    expect(await orderPaid(orderId)).toBe('AWAITING_PAYMENT');
    expect(billing.events).toHaveLength(0);
  });

  it('are paid once, whichever URL delivers the event and however often', async () => {
    const { orderId, attempt } = await paidOrderAttempt();
    verifyAnswers.set(attempt.reference, 'success');
    const results = await Promise.all([
      send('charge.success', { reference: attempt.reference }),
      send('charge.success', { reference: attempt.reference }, billingWebhook),
      send('charge.success', { reference: attempt.reference }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await orderPaid(orderId)).toBe('PAID');
    expect(await prisma.orderPayment.count({ where: { orderId, status: 'SUCCESS' } })).toBe(1);
    // None of it was taken for a subscription charge.
    expect(billing.events).toHaveLength(0);
  });
});

describe('subscription billing', () => {
  it('gets subscription charges (a renewal carries its plan) and its own events — not charges that match nothing', async () => {
    await send('charge.success', { reference: `sub_${suffix}`, status: 'success', plan: { plan_code: 'PLN_x' } });
    await send('subscription.create', { subscription_code: 'SUB_x' });
    await send('invoice.payment_failed', { subscription: { subscription_code: 'SUB_x' } });
    // A reference we never issued is recorded for staff (ROADMAP 11.6), not billed.
    await send('charge.success', { reference: `stray_${suffix}`, status: 'success', amount: 1000 });
    expect(billing.events.map((e) => e.event)).toEqual(['charge.success', 'subscription.create', 'invoice.payment_failed']);
    expect(await prisma.unmatchedPayment.count({ where: { reference: `stray_${suffix}` } })).toBe(1);
    await prisma.unmatchedPayment.deleteMany({ where: { reference: `stray_${suffix}` } });
  });

  it('is served through the old billing URL too', async () => {
    const res = await send('subscription.disable', { subscription_code: 'SUB_y' }, billingWebhook);
    expect(res.status).toBe(200);
    expect(billing.events.map((e) => e.event)).toEqual(['subscription.disable']);
  });
});

describe('refunds (paused)', () => {
  it('are acknowledged and change nothing', async () => {
    const res = await send('refund.processed', { transaction_reference: 'X', status: 'processed' });
    expect(res.status).toBe(200);
    expect(billing.events).toHaveLength(0);
  });
});

/* ---------------- chargebacks ---------------- */

describe('chargebacks', () => {
  const disputeData = (reference: string, over: Record<string, unknown> = {}) => ({
    id: `dispute-${suffix}`,
    refund_amount: 300_000,
    currency: 'NGN',
    status: 'awaiting-merchant-feedback',
    resolution: null,
    category: 'chargeback',
    dueAt: '2026-10-05T18:00:00.000Z',
    resolvedAt: null,
    created_at: '2026-09-29T10:00:00.000Z',
    updated_at: '2026-09-29T10:00:00.000Z',
    transaction: { reference, amount: 300_000, currency: 'NGN' },
    ...over,
  });

  it('are recorded against the order, and the shop and the platform are told once', async () => {
    const { orderId, reference, attempt } = await paidOrderAttempt();

    expect((await send('charge.dispute.create', disputeData(attempt.reference))).status).toBe(200);
    const dispute = await prisma.paymentDispute.findUniqueOrThrow({ where: { providerDisputeId: `dispute-${suffix}` } });
    expect(dispute).toMatchObject({
      orderId,
      paymentId: attempt.id,
      organizationId: store.id,
      status: 'awaiting-merchant-feedback',
      category: 'chargeback',
    });
    expect(Number(dispute.amount)).toBe(3000);
    expect(dispute.dueAt?.toISOString()).toBe('2026-10-05T18:00:00.000Z');

    expect(disputeEmails).toHaveLength(1);
    expect(disputeEmails[0]).toMatchObject({ kind: 'opened', reference });
    expect(disputeEmails[0].to).toEqual(expect.arrayContaining([`owner-wh-${suffix}@example.com`, 'platform@example.com']));
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: store.id, action: 'platform.payments.dispute_opened' } });
    expect(audit).not.toBeNull();

    // The same event again: nothing new.
    await send('charge.dispute.create', disputeData(attempt.reference));
    expect(await prisma.paymentDispute.count({ where: { providerDisputeId: `dispute-${suffix}` } })).toBe(1);

    // A reminder moves it on without another email.
    await send('charge.dispute.remind', disputeData(attempt.reference, { status: 'awaiting-bank-feedback', updated_at: '2026-09-30T10:00:00.000Z' }));
    expect((await prisma.paymentDispute.findUniqueOrThrow({ where: { providerDisputeId: `dispute-${suffix}` } })).status).toBe('awaiting-bank-feedback');
    expect(disputeEmails).toHaveLength(1);

    // An older event arriving late changes nothing.
    await send('charge.dispute.remind', disputeData(attempt.reference, { status: 'awaiting-merchant-feedback', updated_at: '2026-09-29T12:00:00.000Z' }));
    expect((await prisma.paymentDispute.findUniqueOrThrow({ where: { providerDisputeId: `dispute-${suffix}` } })).status).toBe('awaiting-bank-feedback');

    // Settled: recorded, and told once more.
    await send(
      'charge.dispute.resolve',
      disputeData(attempt.reference, { status: 'resolved', resolution: 'declined', resolvedAt: '2026-10-02T09:00:00.000Z', updated_at: '2026-10-02T09:00:00.000Z' }),
    );
    const settled = await prisma.paymentDispute.findUniqueOrThrow({ where: { providerDisputeId: `dispute-${suffix}` } });
    expect(settled).toMatchObject({ status: 'resolved', resolution: 'declined' });
    expect(settled.resolvedAt?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    expect(disputeEmails.map((e) => e.kind)).toEqual(['opened', 'resolved']);
  });

  it('on a payment that isn’t ours are left alone', async () => {
    const res = await send('charge.dispute.create', disputeData('SOMEONE-ELSES-REF', { id: `other-${suffix}` }));
    expect(res.status).toBe(200);
    expect(await prisma.paymentDispute.count({ where: { providerDisputeId: `other-${suffix}` } })).toBe(0);
    expect(disputeEmails).toHaveLength(0);
  });
});
