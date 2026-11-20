/*
 * Wholesale in Reports (ROADMAP 21.8): retail and trade split by whether an
 * order carries a trade buyer's business; the top trade buyers with what
 * they owe today; and money owed — orders on account and unpaid invoices —
 * by how late it is. Nothing from another workspace appears.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { givePlan, dropBilling } from './helpers/plans';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { lagosDay } from '@/lib/reports/period';
import { ageBucket } from '@/lib/reports/ageing';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Trade Reports', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { getTradeReport, getMoneyOwedReport } = await import('@/features/reports/trade-reports');

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const PERIOD = { from: lagosDay(ago(10)), to: lagosDay(new Date()) };

let otherOrgId = '';
const people = { shop: '', retail: '', invoiced: '' };
let seq = 0;

async function order(input: {
  organizationId?: string;
  customerId: string | null;
  total: number;
  business?: string;
  placedAt?: Date;
  status?: 'CONFIRMED' | 'CANCELLED';
  account?: { dueAt: Date; paid?: number };
}) {
  seq += 1;
  return prisma.order.create({
    data: {
      organizationId: input.organizationId ?? ctx.organization.id,
      reference: `TR-${Date.now()}-${seq}`,
      channel: 'ONLINE',
      status: input.status ?? 'CONFIRMED',
      paymentStatus: input.account ? 'ON_ACCOUNT' : 'PAID',
      paymentMethod: input.account ? 'account' : 'paystack',
      customerId: input.customerId,
      placedAt: input.placedAt ?? ago(2),
      subtotal: input.total,
      totalAmount: input.total,
      buyerBusinessName: input.business ?? null,
      accountDueAt: input.account?.dueAt ?? null,
      accountPaidAmount: input.account?.paid ?? 0,
    },
  });
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: 'Trade Reports', slug: `__test-trade-reports-${stamp}`, wholesaleMode: 'RETAIL_AND_TRADE' } });
  ctx.organization.id = org.id;
  await givePlan(org.id); // Wholesale is a plan feature (22.1)
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SALES_VIEW];
  otherOrgId = (await prisma.organization.create({ data: { name: 'Other', slug: `__test-trade-reports-other-${stamp}` } })).id;

  people.shop = (await prisma.customer.create({ data: { organizationId: org.id, name: 'Bola Ade' } })).id;
  people.retail = (await prisma.customer.create({ data: { organizationId: org.id, name: 'Chi Obi' } })).id;
  people.invoiced = (await prisma.customer.create({ data: { organizationId: org.id, name: 'Dayo Bello' } })).id;
  await prisma.tradeAccount.create({ data: { organizationId: org.id, customerId: people.shop, status: 'APPROVED', businessName: 'Bola Stores', onAccount: true } });

  // Trade: ₦300,000 over two orders, one on account (₦200,000, ₦50,000 paid, 40 days late).
  await order({ customerId: people.shop, total: 100_000, business: 'Bola Stores' });
  await order({ customerId: people.shop, total: 200_000, business: 'Bola Stores', account: { dueAt: ago(40), paid: 50_000 } });
  // Retail: ₦100,000, plus a cancelled one that counts for nothing.
  await order({ customerId: people.retail, total: 100_000 });
  await order({ customerId: people.retail, total: 999_000, status: 'CANCELLED' });
  // An invoice to a retail customer, not due yet.
  await prisma.invoice.create({
    data: { organizationId: org.id, customerId: people.invoiced, invoiceNumber: `INV-${stamp}`, status: 'SENT', subtotal: 20_000, totalAmount: 20_000, dueDate: new Date(Date.now() + 5 * DAY) },
  });
  // Another workspace's trade order and debt.
  const outsider = await prisma.customer.create({ data: { organizationId: otherOrgId, name: 'Outsider' } });
  await order({ organizationId: otherOrgId, customerId: outsider.id, total: 5_000_000, business: 'Elsewhere', account: { dueAt: ago(90) } });
});

afterAll(async () => {
  const ids = [ctx.organization.id, otherOrgId];
  await prisma.order.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.invoice.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.tradeAccount.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { organizationId: { in: ids } } });
  await dropBilling(ctx.organization.id);
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
});

describe('retail and trade', () => {
  it('splits the period’s sales by whether a wholesaler placed the order', async () => {
    const result = await getTradeReport(PERIOD);
    if (!result.success) throw new Error(result.error);
    const report = result.data;
    expect(report.trade).toEqual({ sales: 300_000, orders: 2, averageOrder: 150_000 });
    expect(report.retail).toEqual({ sales: 100_000, orders: 1, averageOrder: 100_000 });
    expect(report.tradeShareRatio).toBe(0.75);
    expect(report.tradeBuyers).toBe(1);
    expect(report.rows).toEqual([
      expect.objectContaining({ customerId: people.shop, businessName: 'Bola Stores', orders: 2, spend: 300_000, owed: 150_000 }),
    ]);
  });
});

describe('money owed', () => {
  it('ages orders on account and unpaid invoices together, today, this shop only', async () => {
    const result = await getMoneyOwedReport();
    if (!result.success) throw new Error(result.error);
    const report = result.data;
    expect(report.totals).toEqual({ notDue: 20_000, days1to30: 0, days31to60: 150_000, over60: 0, owed: 170_000, overdue: 150_000 });
    expect(report.customers).toBe(2);
    // The most overdue first.
    expect(report.rows.map((r) => r.name)).toEqual(['Bola Stores', 'Dayo Bello']);
    expect(report.rows[0]).toMatchObject({ trade: true, items: 1 });
    expect(report.rows[1]).toMatchObject({ trade: false, ages: { notDue: 20_000 } });
  });

  it('puts each amount in its bucket by whole days late', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const late = (days: number) => new Date(now.getTime() - days * DAY);
    expect(ageBucket(null, now)).toBe('notDue');
    expect(ageBucket(new Date(now.getTime() + 1), now)).toBe('notDue');
    expect(ageBucket(late(0.5), now)).toBe('days1to30');
    expect(ageBucket(late(30), now)).toBe('days1to30');
    expect(ageBucket(late(30.5), now)).toBe('days31to60');
    expect(ageBucket(late(60), now)).toBe('days31to60');
    expect(ageBucket(late(61), now)).toBe('over60');
  });
});
