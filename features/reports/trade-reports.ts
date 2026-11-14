'use server';

/*
 * features/reports/trade-reports.ts
 *
 * Wholesale in Reports (ROADMAP 21.8):
 *
 *   - TRADE: retail and trade side by side for the period, and the trade
 *     buyers who spent the most. A trade order is one an approved trade buyer
 *     placed — it carries their business (Order.buyerBusinessName, 21.6).
 *     Counted like the Sales view: every order placed in the period at what
 *     was charged, cancelled ones left out.
 *   - MONEY OWED: who owes the business what, today, by how late it is —
 *     orders on account (21.5) and unpaid invoices together, as the buyer's
 *     balance counts them (lib/trade/credit.ts). Not tied to the period: it's
 *     where things stand now.
 *
 * Needs `sales.view`. Every query is scoped to the shop.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { resolvePeriod } from '@/lib/reports/period';
import { toActionError, type ActionResult } from '@/features/sales/shared';
import type { PeriodInput } from './sales-reports';
import { ageBucket, emptyAges, type AgeFigures } from '@/lib/reports/ageing';

async function salesContext() {
  const ctx = await getOrganizationContext();
  requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
  return ctx;
}

const round = (value: number) => Math.round(value * 100) / 100;

// ── Retail and trade ─────────────────────────────────────────────────────

export interface SideFigures {
  sales: number;
  orders: number;
  averageOrder: number | null;
}

export interface TopTradeBuyerRow {
  customerId: string;
  businessName: string;
  orders: number;
  spend: number;
  lastOrderAt: string;
  /** owed today, across orders on account and unpaid invoices */
  owed: number;
}

export interface TradeReport {
  retail: SideFigures;
  trade: SideFigures;
  /** trade's share of sales in the period, 0–1; null with no sales */
  tradeShareRatio: number | null;
  /** distinct trade buyers who ordered in the period */
  tradeBuyers: number;
  rows: TopTradeBuyerRow[];
}

const TOP_ROWS = 50;

export async function getTradeReport(input: PeriodInput): Promise<ActionResult<TradeReport>> {
  try {
    const ctx = await salesContext();
    const organizationId = ctx.organization.id;
    const period = resolvePeriod(input);
    const counted = { organizationId, status: { not: 'CANCELLED' as const }, placedAt: { gte: period.from, lt: period.to } };

    const [trade, retail, buyers] = await Promise.all([
      prisma.order.aggregate({ where: { ...counted, buyerBusinessName: { not: null } }, _sum: { totalAmount: true }, _count: { _all: true } }),
      prisma.order.aggregate({ where: { ...counted, buyerBusinessName: null }, _sum: { totalAmount: true }, _count: { _all: true } }),
      prisma.order.groupBy({
        by: ['customerId'],
        where: { ...counted, buyerBusinessName: { not: null }, customerId: { not: null } },
        _sum: { totalAmount: true },
        _count: { _all: true },
        _max: { placedAt: true },
      }),
    ]);

    const side = (sum: { toString(): string } | null, count: number): SideFigures => {
      const sales = sum === null ? 0 : Number(sum.toString());
      return { sales, orders: count, averageOrder: count > 0 ? round(sales / count) : null };
    };
    const tradeSide = side(trade._sum.totalAmount, trade._count._all);
    const retailSide = side(retail._sum.totalAmount, retail._count._all);
    const all = tradeSide.sales + retailSide.sales;

    const top = buyers
      .map((b) => ({ customerId: b.customerId!, spend: Number(b._sum.totalAmount ?? 0), orders: b._count._all, lastOrderAt: b._max.placedAt! }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, TOP_ROWS);
    const ids = top.map((t) => t.customerId);

    // Their business names, and what each owes today — the same two sources as their balance.
    const [accounts, customers, owedOrders, owedInvoices] = ids.length
      ? await Promise.all([
          prisma.tradeAccount.findMany({ where: { organizationId, customerId: { in: ids } }, select: { customerId: true, businessName: true } }),
          prisma.customer.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } }),
          prisma.order.findMany({
            where: { organizationId, customerId: { in: ids }, paymentStatus: 'ON_ACCOUNT', status: { not: 'CANCELLED' } },
            select: { customerId: true, totalAmount: true, accountPaidAmount: true },
          }),
          prisma.invoice.findMany({
            where: { organizationId, customerId: { in: ids }, status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
            select: { customerId: true, totalAmount: true, paidAmount: true },
          }),
        ])
      : [[], [], [], []];
    const owed = new Map<string, number>();
    for (const o of owedOrders) owed.set(o.customerId!, (owed.get(o.customerId!) ?? 0) + Number(o.totalAmount) - Number(o.accountPaidAmount));
    for (const i of owedInvoices) owed.set(i.customerId, (owed.get(i.customerId) ?? 0) + Number(i.totalAmount) - Number(i.paidAmount));
    const business = new Map(accounts.map((a) => [a.customerId, a.businessName]));
    const name = new Map(customers.map((c) => [c.id, c.name]));

    return {
      success: true,
      data: {
        trade: tradeSide,
        retail: retailSide,
        tradeShareRatio: all > 0 ? tradeSide.sales / all : null,
        tradeBuyers: buyers.length,
        rows: top.map((t) => ({
          customerId: t.customerId,
          businessName: business.get(t.customerId) ?? name.get(t.customerId) ?? 'Trade buyer',
          orders: t.orders,
          spend: round(t.spend),
          lastOrderAt: t.lastOrderAt.toISOString(),
          owed: round(Math.max(0, owed.get(t.customerId) ?? 0)),
        })),
      },
    };
  } catch (error) {
    return toActionError(error, 'We couldn’t load the trade report');
  }
}

// ── Money owed, by age ───────────────────────────────────────────────────

export interface MoneyOwedRow {
  customerId: string;
  /** the business for a trade buyer, otherwise the customer's name */
  name: string;
  trade: boolean;
  owed: number;
  ages: AgeFigures;
  /** open orders on account plus unpaid invoices */
  items: number;
  /** the oldest due date still unpaid */
  oldestDueAt: string | null;
}

export interface MoneyOwedReport {
  totals: AgeFigures & { owed: number; overdue: number };
  customers: number;
  rows: MoneyOwedRow[];
}

export async function getMoneyOwedReport(): Promise<ActionResult<MoneyOwedReport>> {
  try {
    const ctx = await salesContext();
    const organizationId = ctx.organization.id;
    const now = new Date();

    const [orders, invoices] = await Promise.all([
      prisma.order.findMany({
        where: { organizationId, paymentStatus: 'ON_ACCOUNT', status: { not: 'CANCELLED' }, customerId: { not: null } },
        select: { customerId: true, totalAmount: true, accountPaidAmount: true, accountDueAt: true },
      }),
      prisma.invoice.findMany({
        where: { organizationId, status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        select: { customerId: true, totalAmount: true, paidAmount: true, dueDate: true },
      }),
    ]);

    const byCustomer = new Map<string, { owed: number; ages: AgeFigures; items: number; oldest: Date | null }>();
    const add = (customerId: string, amount: number, dueAt: Date | null) => {
      if (amount <= 0) return;
      const entry = byCustomer.get(customerId) ?? { owed: 0, ages: emptyAges(), items: 0, oldest: null };
      entry.owed += amount;
      entry.ages[ageBucket(dueAt, now)] += amount;
      entry.items += 1;
      if (dueAt && (!entry.oldest || dueAt < entry.oldest)) entry.oldest = dueAt;
      byCustomer.set(customerId, entry);
    };
    for (const o of orders) add(o.customerId!, Number(o.totalAmount) - Number(o.accountPaidAmount), o.accountDueAt);
    for (const i of invoices) add(i.customerId, Number(i.totalAmount) - Number(i.paidAmount), i.dueDate);

    const ids = [...byCustomer.keys()];
    const [customers, accounts] = ids.length
      ? await Promise.all([
          prisma.customer.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } }),
          prisma.tradeAccount.findMany({ where: { organizationId, customerId: { in: ids } }, select: { customerId: true, businessName: true } }),
        ])
      : [[], []];
    const name = new Map(customers.map((c) => [c.id, c.name]));
    const business = new Map(accounts.map((a) => [a.customerId, a.businessName]));

    const rows: MoneyOwedRow[] = ids
      .map((id) => {
        const entry = byCustomer.get(id)!;
        return {
          customerId: id,
          name: business.get(id) ?? name.get(id) ?? 'Customer',
          trade: business.has(id),
          owed: round(entry.owed),
          ages: {
            notDue: round(entry.ages.notDue),
            days1to30: round(entry.ages.days1to30),
            days31to60: round(entry.ages.days31to60),
            over60: round(entry.ages.over60),
          },
          items: entry.items,
          oldestDueAt: entry.oldest?.toISOString() ?? null,
        };
      })
      // The most overdue first: oldest money, then the most of it.
      .sort((a, b) => b.ages.over60 - a.ages.over60 || b.ages.days31to60 - a.ages.days31to60 || b.ages.days1to30 - a.ages.days1to30 || b.owed - a.owed);

    const totals = rows.reduce(
      (sum, r) => ({
        notDue: sum.notDue + r.ages.notDue,
        days1to30: sum.days1to30 + r.ages.days1to30,
        days31to60: sum.days31to60 + r.ages.days31to60,
        over60: sum.over60 + r.ages.over60,
        owed: sum.owed + r.owed,
      }),
      { ...emptyAges(), owed: 0 },
    );

    return {
      success: true,
      data: {
        totals: {
          notDue: round(totals.notDue),
          days1to30: round(totals.days1to30),
          days31to60: round(totals.days31to60),
          over60: round(totals.over60),
          owed: round(totals.owed),
          overdue: round(totals.days1to30 + totals.days31to60 + totals.over60),
        },
        customers: rows.length,
        rows,
      },
    };
  } catch (error) {
    return toActionError(error, 'We couldn’t load what you’re owed');
  }
}
