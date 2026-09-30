/*
 * Payment problems in the platform console (ROADMAP 11.6), against the real
 * database. Paystack's verify is stubbed per reference; billing and shopper
 * emails are stubbed. Lists are shared with the rest of the dev database, so
 * checks look for this test's own rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/auth', () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: vi.fn(async () => {
    throw new Error('no request context in this test');
  }),
}));

const verify = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/payments/paystack', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/paystack')>()),
  verifyPaystackTransaction: async (reference: string) => verify.get(reference) ?? null,
}));
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
}));
const billing = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/billing/webhook-events', () => ({
  handleBillingEvent: async (event: string) => {
    billing.push(event);
  },
}));

const payments = await import('@/features/platform/payments');
type PaymentTab = import('@/features/platform/payments').PaymentTab;
const { routePaystackEvent } = await import('@/lib/payments/paystack-webhook');

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const OUR_SUBACCOUNT = `ACCT_ours_${suffix}`;
let staffId = '';
let merchantId = '';
let orgId = '';
let orderId = '';
const ids = { paid: '', abandoned: '', fresh: '', mismatch: '' };
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function attempt(reference: string, over: Record<string, unknown> = {}) {
  return (
    await prisma.orderPayment.create({
      data: {
        organizationId: orgId,
        orderId,
        provider: 'paystack',
        reference,
        status: 'PENDING',
        amount: 5000,
        currency: 'NGN',
        returnUrl: 'https://example.com',
        subaccountCode: OUR_SUBACCOUNT,
        ...over,
      },
    })
  ).id;
}

beforeAll(async () => {
  staffId = (await prisma.user.create({ data: { name: 'Payments Staff', email: `pay-staff-${suffix}@example.com`, isPlatformStaff: true } })).id;
  merchantId = (await prisma.user.create({ data: { email: `pay-merchant-${suffix}@example.com` } })).id;
  orgId = (await prisma.organization.create({ data: { name: 'Payments Test Shop', slug: `__test-pay-${suffix}` } })).id;
  orderId = (
    await prisma.order.create({
      data: { organizationId: orgId, reference: `PT-${suffix}`, paymentMethod: 'paystack', subtotal: 5000, totalAmount: 5000 },
    })
  ).id;
  ids.paid = await attempt(`pt-paid-${suffix}`, { createdAt: ago(120) });
  ids.abandoned = await attempt(`pt-gone-${suffix}`, { createdAt: ago(120) });
  ids.fresh = await attempt(`pt-fresh-${suffix}`, { createdAt: ago(10) });
  ids.mismatch = await attempt(`pt-mis-${suffix}`, {
    status: 'MISMATCH',
    verifiedAt: new Date(),
    providerPayload: { amount: 450000, currency: 'NGN', subaccount: { subaccount_code: 'ACCT_someone_else' }, fees_split: { integration: 1000 } },
  });
  await prisma.paymentDispute.create({
    data: {
      organizationId: orgId,
      orderId,
      paymentId: ids.mismatch,
      providerDisputeId: `dsp-${suffix}`,
      status: 'awaiting-merchant-feedback',
      amount: 5000,
      currency: 'NGN',
      dueAt: new Date(Date.now() + 2 * 86400_000),
      lastEventAt: new Date(),
    },
  });
  await prisma.merchantPaymentAccount.create({
    data: {
      organizationId: orgId,
      verificationStatus: 'VERIFIED',
      setupStatus: 'ACTION_REQUIRED',
      setupError: 'Paystack said the account number is invalid.',
      paystackSubaccountCode: OUR_SUBACCOUNT,
    },
  });

  verify.set(`pt-paid-${suffix}`, {
    reference: `pt-paid-${suffix}`,
    status: 'success',
    amount: 500000,
    currency: 'NGN',
    channel: 'card',
    id: '1',
    subaccountCode: OUR_SUBACCOUNT,
    split: { merchant: 492500, platform: 0, fee: 7500 },
    raw: {},
  });
});

afterAll(async () => {
  await prisma.unmatchedPayment.deleteMany({ where: { reference: { contains: suffix } } });
  await prisma.paymentDispute.deleteMany({ where: { organizationId: orgId } });
  await prisma.orderPayment.deleteMany({ where: { organizationId: orgId } });
  await prisma.order.deleteMany({ where: { organizationId: orgId } });
  await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [staffId, merchantId] } } });
});

describe('the webhook records what matches nothing', () => {
  it('records an unknown charge once, leaves renewals to billing, and records a dispute on nothing of ours', async () => {
    const charge = {
      reference: `nope-${suffix}`,
      amount: 150000,
      currency: 'NGN',
      subaccount: { subaccount_code: OUR_SUBACCOUNT },
      customer: { email: 'someone@example.com' },
    };
    expect(await routePaystackEvent('charge.success', charge)).toBe('unmatched');
    expect(await routePaystackEvent('charge.success', charge)).toBe('unmatched');
    expect(await prisma.unmatchedPayment.count({ where: { reference: `nope-${suffix}` } })).toBe(1);

    billing.length = 0;
    expect(await routePaystackEvent('charge.success', { reference: `renew-${suffix}`, plan: { plan_code: 'PLN_x' } })).toBe('billing');
    expect(billing).toEqual(['charge.success']);
    expect(await prisma.unmatchedPayment.count({ where: { reference: `renew-${suffix}` } })).toBe(0);

    expect(await routePaystackEvent('charge.dispute.create', { id: 999, transaction: { reference: `nodispute-${suffix}`, amount: 20000 } })).toBe('dispute');
    expect(await prisma.unmatchedPayment.findUnique({ where: { kind_reference: { kind: 'dispute', reference: `nodispute-${suffix}` } } })).not.toBeNull();
  });
});

describe('the console', () => {
  it('is for platform staff only', async () => {
    session.userId = merchantId;
    expect(await payments.listPaymentProblems({})).toMatchObject({ success: false, error: expect.stringMatching(/platform staff/) });
  });

  it('lists each kind of problem', async () => {
    session.userId = staffId;
    const tab = async <T extends PaymentTab>(t: T) => {
      const r = await payments.listPaymentProblems({ tab: t });
      if (!r.success) throw new Error(r.error);
      return r.data;
    };

    const stuck = await tab('stuck');
    const stuckIds = stuck.rows.map((r) => (r as { id: string }).id);
    expect(stuckIds).toEqual(expect.arrayContaining([ids.paid, ids.abandoned]));
    expect(stuckIds).not.toContain(ids.fresh); // still inside the hold

    const mismatched = await tab('mismatched');
    expect(mismatched.rows.find((r) => (r as { id: string }).id === ids.mismatch)).toMatchObject({
      amount: 5000,
      reportedAmount: 4500,
      expectedSubaccount: OUR_SUBACCOUNT,
      reportedSubaccount: 'ACCT_someone_else',
      platformShare: 10,
    });

    const unmatched = await tab('unmatched');
    expect(unmatched.rows.find((r) => (r as { reference: string }).reference === `nope-${suffix}`)).toMatchObject({
      amount: 1500,
      shop: { id: orgId, name: 'Payments Test Shop' },
      customerEmail: 'someone@example.com',
    });

    const disputes = await tab('disputes');
    expect(disputes.rows.some((r) => (r as { shop: { id: string } }).shop.id === orgId)).toBe(true);

    const payouts = await tab('payouts');
    expect(payouts.rows.find((r) => (r as { shop: { id: string } }).shop.id === orgId)).toMatchObject({
      setupStatus: 'ACTION_REQUIRED',
      setupError: 'Paystack said the account number is invalid.',
    });
  });

  it('settles a stuck payment Paystack has, and closes one Paystack never saw', async () => {
    session.userId = staffId;
    expect(await payments.checkStuckPayment(ids.paid)).toMatchObject({ success: true, data: { outcome: 'paid' } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe('PAID');

    expect(await payments.checkStuckPayment(ids.abandoned)).toMatchObject({ success: true, data: { outcome: 'abandoned' } });
    expect((await prisma.orderPayment.findUniqueOrThrow({ where: { id: ids.abandoned } })).status).toBe('ABANDONED');

    // Inside the hold, an attempt Paystack hasn't seen is left alone.
    expect(await payments.checkStuckPayment(ids.fresh)).toMatchObject({ success: true, data: { outcome: 'pending' } });
    expect((await prisma.orderPayment.findUniqueOrThrow({ where: { id: ids.fresh } })).status).toBe('PENDING');
  });

  it('records what staff found, and takes it off the list', async () => {
    session.userId = staffId;
    expect(await payments.markPaymentReviewed(ids.mismatch, 'no')).toMatchObject({ success: false });
    expect(await payments.markPaymentReviewed(ids.mismatch, 'Shopper paid twice; Paystack refunded the second.')).toMatchObject({ success: true });
    const row = await prisma.orderPayment.findUniqueOrThrow({ where: { id: ids.mismatch } });
    expect(row).toMatchObject({ status: 'MISMATCH', reviewedById: staffId });
    expect(await payments.markPaymentReviewed(ids.mismatch, 'Again, a second time.')).toMatchObject({ success: false });

    const unmatched = await prisma.unmatchedPayment.findFirstOrThrow({ where: { reference: `nope-${suffix}` } });
    expect(await payments.resolveUnmatchedPayment(unmatched.id, 'A test charge made from the Paystack dashboard.')).toMatchObject({ success: true });
    const after = await payments.listPaymentProblems({ tab: 'unmatched' });
    expect(after.success && after.data.rows.some((r) => (r as { id: string }).id === unmatched.id)).toBe(false);
  });
});
