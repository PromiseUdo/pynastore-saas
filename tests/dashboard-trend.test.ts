/*
 * The home page's sales chart (dashboard recommendation 1): the last 30
 * Lagos days against the 30 before, counted as Reports → Sales counts them —
 * orders placed, at their total, cancelled ones left out — and only this
 * shop's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { lagosDay } from '@/lib/reports/period';

// The page's own reader signs the member in; the trend itself only needs the shop.
vi.mock('@/lib/organization', () => ({ getOrganizationContext: vi.fn() }));
const { salesTrend, weekFigures } = await import('@/features/dashboard/overview');

const DAY = 86_400_000;
const ids = { shop: '', other: '' };
let seq = 0;
// Midday Lagos, `days` ago — well inside its day whatever the clock says.
const at = (days: number) => new Date(Date.parse(`${lagosDay(new Date(Date.now() - days * DAY))}T11:00:00Z`));

async function order(
  organizationId: string,
  total: number,
  daysAgo: number,
  status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED',
  extra: { channel?: 'ONLINE' | 'WALK_IN'; account?: { paid: number; dueDaysAgo: number } } = {},
) {
  seq += 1;
  await prisma.order.create({
    data: {
      organizationId,
      reference: `TREND-${Date.now()}-${seq}`,
      channel: extra.channel ?? 'WALK_IN',
      status,
      paymentStatus: extra.account ? 'ON_ACCOUNT' : 'PAID',
      paymentMethod: extra.account ? 'account' : 'cash',
      accountPaidAmount: extra.account?.paid ?? 0,
      accountDueAt: extra.account ? new Date(Date.now() - extra.account.dueDaysAgo * DAY) : null,
      placedAt: at(daysAgo),
      subtotal: total,
      totalAmount: total,
    },
  });
}

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ids.shop = (await prisma.organization.create({ data: { name: 'Trend Shop', slug: `__test-trend-${stamp}` } })).id;
  ids.other = (await prisma.organization.create({ data: { name: 'Other', slug: `__test-trend-other-${stamp}` } })).id;
  await order(ids.shop, 10_000, 0); // today
  await order(ids.shop, 5_000, 0);
  await order(ids.shop, 20_000, 5);
  await order(ids.shop, 99_000, 5, 'CANCELLED'); // never counts
  await order(ids.shop, 8_000, 35); // the 30 days before: matches 5 days ago
  await order(ids.shop, 1_000, 61); // older than both windows
  await order(ids.other, 500_000, 0); // another shop's
  // For the 7-day figures: one in the 7 days before (10 days ago), online.
  await order(ids.shop, 6_000, 10, 'CONFIRMED', { channel: 'ONLINE' });
  // Owed: ₦50,000 on account, ₦10,000 paid, 3 days overdue — placed long ago, outside every window.
  await order(ids.shop, 50_000, 90, 'CONFIRMED', { account: { paid: 10_000, dueDaysAgo: 3 } });
  const customer = await prisma.customer.create({ data: { organizationId: ids.shop, name: 'Invoiced' } });
  await prisma.invoice.create({
    data: { organizationId: ids.shop, customerId: customer.id, invoiceNumber: `INV-TREND-${Date.now()}`, status: 'SENT', subtotal: 5_000, totalAmount: 5_000, dueDate: new Date(Date.now() + 5 * DAY) },
  });
});

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { organizationId: ids.shop } });
  await prisma.customer.deleteMany({ where: { organizationId: ids.shop } });
  await prisma.order.deleteMany({ where: { organizationId: { in: [ids.shop, ids.other] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.shop, ids.other] } } });
});

describe('the home page sales chart', () => {
  it('is thirty days ending today, each beside the same day thirty days earlier', async () => {
    const trend = await salesTrend(ids.shop);
    expect(trend.days).toHaveLength(30);
    expect(trend.days.at(-1)).toMatchObject({ day: lagosDay(new Date()), sales: 15_000, orders: 2 });
    const fiveAgo = trend.days.find((d) => d.day === lagosDay(at(5)))!;
    expect(fiveAgo).toMatchObject({ sales: 20_000, orders: 1, previousDay: lagosDay(at(35)), previousSales: 8_000 });
  });

  it('adds up like the Sales report: cancelled orders, older ones and other shops left out', async () => {
    const trend = await salesTrend(ids.shop);
    expect(trend).toMatchObject({ total: 41_000, orders: 4, previousTotal: 8_000 });
  });
});

describe('the home page figures', () => {
  it('compares the last 7 days with the 7 before, with today so far', async () => {
    const week = await weekFigures(ids.shop);
    expect(week.current).toEqual({ sales: 35_000, orders: 3, averageOrder: 11_666.67 });
    expect(week.previous).toEqual({ sales: 6_000, orders: 1, averageOrder: 6_000 });
    expect(week.todaySales).toBe(15_000);
    expect(week.byChannel).toEqual([{ channel: 'WALK_IN', count: 3 }]);
  });

  it('counts what’s owed from orders on account and invoices, and how much is overdue', async () => {
    const week = await weekFigures(ids.shop);
    expect(week.owed).toEqual({ total: 45_000, overdue: 40_000 });
  });
});
