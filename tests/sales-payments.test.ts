// Sales → Payments (ROADMAP 10.6), against the real DB with a mocked org context.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Pay List', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] }, warehouseIds: [] },
  userId: 'u',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { listOnlinePayments, exportOnlinePayments } = await import('@/features/sales/payments');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let otherOrgId = '';
const DAY = 86_400_000;

async function orderWithPayment(
  organizationId: string,
  ref: string,
  payment: {
    status?: 'SUCCESS' | 'PENDING' | 'FAILED';
    provider?: string;
    amount?: number;
    fee?: number | null;
    daysAgo?: number;
    gatewayRef?: string | null;
  } = {},
) {
  const amount = payment.amount ?? 10_000;
  const order = await prisma.order.create({
    data: {
      organizationId,
      reference: `${ref}-${suffix}`,
      paymentMethod: payment.provider ?? 'paystack',
      subtotal: amount,
      totalAmount: amount,
      email: `${ref.toLowerCase()}-${suffix}@example.com`,
      firstName: 'Ada',
      lastName: ref,
      paymentStatus: payment.status === 'SUCCESS' || payment.status === undefined ? 'PAID' : 'AWAITING_PAYMENT',
    },
  });
  const fee = payment.fee === undefined ? amount * 0.015 + 100 : payment.fee;
  const when = new Date(Date.now() - (payment.daysAgo ?? 1) * DAY);
  const attempt = await prisma.orderPayment.create({
    data: {
      organizationId,
      orderId: order.id,
      provider: payment.provider ?? 'paystack',
      reference: `${ref}-${suffix}-A`,
      status: payment.status ?? 'SUCCESS',
      amount,
      currency: 'NGN',
      returnUrl: 'https://shop.example/c',
      gatewayRef: payment.gatewayRef === undefined ? `${ref}-GW-${suffix}` : payment.gatewayRef,
      verifiedAt: when,
      ...(fee === null
        ? {}
        : { feeAmount: fee, merchantAmount: amount - fee, platformAmount: 0, subaccountCode: 'ACCT_x' }),
    },
  });
  return { order, attempt };
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: 'Pay List', slug: `__test-paylist-${suffix}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
  otherOrgId = (await prisma.organization.create({ data: { name: 'Other', slug: `__test-paylist-other-${suffix}` } })).id;

  await prisma.merchantPaymentAccount.create({
    data: {
      organizationId: org.id,
      verificationStatus: 'VERIFIED',
      setupStatus: 'ACTIVE',
      paystackSubaccountCode: `ACCT_paylist_${suffix}`,
      settlementBankName: 'Zenith Bank',
      settlementAccountNumber: '0123456789',
      settlementAccountName: 'PAY LIST LTD',
    },
  });

  await orderWithPayment(org.id, 'RECENT', { amount: 20_000, fee: 400, daysAgo: 1 });
  const disputed = await orderWithPayment(org.id, 'DISPUTED', { amount: 5_000, fee: 175, daysAgo: 3 });
  await prisma.paymentDispute.create({
    data: {
      organizationId: org.id,
      orderId: disputed.order.id,
      paymentId: disputed.attempt.id,
      providerDisputeId: `d-${suffix}`,
      status: 'awaiting-merchant-feedback',
      amount: 5_000,
      currency: 'NGN',
      lastEventAt: new Date(),
    },
  });
  const refunded = await orderWithPayment(org.id, 'REFUNDED', { amount: 8_000, fee: 220, daysAgo: 5 });
  await prisma.orderRefund.create({ data: { organizationId: org.id, orderId: refunded.order.id, amount: 3_000 } });
  await orderWithPayment(org.id, 'LEGACY', { provider: 'squad', amount: 4_000, fee: null, daysAgo: 7, gatewayRef: null });
  await orderWithPayment(org.id, 'OLD', { amount: 9_000, fee: 235, daysAgo: 40 });
  // Not payments: an attempt that never went through, and one that failed.
  await orderWithPayment(org.id, 'PENDINGX', { status: 'PENDING' });
  await orderWithPayment(org.id, 'FAILEDX', { status: 'FAILED' });
  // Another business's payment.
  await orderWithPayment(otherOrgId, 'FOREIGN', { amount: 99_000 });
});

afterAll(async () => {
  for (const organizationId of [ctx.organization.id, otherOrgId]) {
    await prisma.paymentDispute.deleteMany({ where: { organizationId } });
    await prisma.orderRefund.deleteMany({ where: { organizationId } });
    await prisma.orderPayment.deleteMany({ where: { organizationId } });
    await prisma.order.deleteMany({ where: { organizationId } });
    await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});

const refsOf = (rows: { orderReference: string }[]) => rows.map((r) => r.orderReference.replace(`-${suffix}`, ''));

describe('the payments list', () => {
  it('lists only this store’s successful payments in the last 30 days, newest first, with Paystack’s figures', async () => {
    const result = await listOnlinePayments({});
    if (!result.success) throw new Error(result.error);
    const list = result.data;
    expect(refsOf(list.rows)).toEqual(['RECENT', 'DISPUTED', 'REFUNDED', 'LEGACY']);
    expect(list.range).toBe('30d');

    const recent = list.rows[0];
    expect(recent).toMatchObject({ amount: 20_000, feeAmount: 400, merchantAmount: 19_600, provider: 'paystack', refunded: 0 });
    // A Squad-era payment has no Paystack split to show.
    expect(list.rows.find((r) => r.provider === 'squad')).toMatchObject({ feeAmount: null, merchantAmount: null });
    expect(list.rows.find((r) => r.orderReference.startsWith('REFUNDED'))?.refunded).toBe(3_000);
    expect(list.rows.find((r) => r.orderReference.startsWith('DISPUTED'))?.disputeStatus).toBe('awaiting-merchant-feedback');
  });

  it('totals the whole filtered set, as Paystack reported it', async () => {
    const result = await listOnlinePayments({});
    expect(result.success && result.data.totals).toEqual({
      count: 4,
      paid: 20_000 + 5_000 + 8_000 + 4_000,
      fees: 400 + 175 + 220,
      received: 19_600 + 4_825 + 7_780,
    });
    expect(result.success && result.data.historySize).toBe(5);
  });

  it('widens and narrows by period', async () => {
    const week = await listOnlinePayments({ range: '7d' });
    expect(week.success && refsOf(week.data.rows)).toEqual(['RECENT', 'DISPUTED', 'REFUNDED']);
    const all = await listOnlinePayments({ range: 'all' });
    expect(all.success && refsOf(all.data.rows)).toContain('OLD');
    // Anything unrecognised is the default, not an error.
    const unknown = await listOnlinePayments({ range: 'forever' });
    expect(unknown.success && unknown.data.range).toBe('30d');
  });

  it('shows only payments with a chargeback when asked', async () => {
    const result = await listOnlinePayments({ view: 'disputed', range: 'all' });
    expect(result.success && refsOf(result.data.rows)).toEqual(['DISPUTED']);
  });

  it('searches by order, Paystack reference and customer', async () => {
    const byOrder = await listOnlinePayments({ q: 'REFUNDED', range: 'all' });
    expect(byOrder.success && refsOf(byOrder.data.rows)).toEqual(['REFUNDED']);
    const byGateway = await listOnlinePayments({ q: `RECENT-GW-${suffix}`, range: 'all' });
    expect(byGateway.success && refsOf(byGateway.data.rows)).toEqual(['RECENT']);
    const byEmail = await listOnlinePayments({ q: `legacy-${suffix}@example.com`, range: 'all' });
    expect(byEmail.success && refsOf(byEmail.data.rows)).toEqual(['LEGACY']);
  });

  it('never shows another business’s payment, even when searched for', async () => {
    const result = await listOnlinePayments({ q: 'FOREIGN', range: 'all' });
    expect(result.success && result.data.rows).toEqual([]);
  });

  it('says where the money goes, masked', async () => {
    const result = await listOnlinePayments({});
    expect(result.success && result.data.settlement).toEqual({
      bankName: 'Zenith Bank',
      accountNumber: '••••6789',
      accountName: 'PAY LIST LTD',
    });
  });

  it('clamps a page past the end to the last page', async () => {
    const result = await listOnlinePayments({ page: 99 });
    expect(result.success && result.data.page).toBe(1);
  });

  it('downloads every payment the filters match, not just the page', async () => {
    const result = await exportOnlinePayments({ range: 'all' });
    expect(result.success && refsOf(result.data).sort()).toEqual(['DISPUTED', 'LEGACY', 'OLD', 'RECENT', 'REFUNDED']);
  });

  it('is refused to someone who can’t see sales', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.INVENTORY_VIEW];
    try {
      expect(await listOnlinePayments({})).toMatchObject({ success: false, error: expect.stringMatching(/permission/) });
      expect(await exportOnlinePayments({})).toMatchObject({ success: false });
    } finally {
      ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
    }
  });
});
