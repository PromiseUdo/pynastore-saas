/*
 * features/dashboard/overview.ts
 *
 * Everything the home page shows, in one place.
 *
 * It is NOT a server action: the page renders on the server and calls this
 * directly. Each figure is a database count or aggregate — the page never
 * loads a store's orders or stock into memory to count them (AGENTS §3).
 *
 * What a member can see follows their permissions: someone with only
 * `inventory.view` gets the stock figures and no money.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { startOfTodayInLagos } from '@/lib/day';
import { getOnlinePaymentReadiness } from '@/lib/payments/online-readiness';
import type { OnlinePaymentBlocker } from '@/lib/payments/payment-setup';
import { Prisma } from '@/lib/generated/prisma/client';
import { bucketKeys, lagosDay, previousPeriod, resolvePeriod } from '@/lib/reports/period';

/** Orders the merchant still has something to do about. */
const OPEN_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING'] as const;

export interface RecentOrder {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  customerName: string;
  itemCount: number;
  totalAmount: number;
  placedAt: string;
}

/** Sales over a stretch of days, as Reports → Sales counts them. */
export interface PeriodFigures {
  sales: number;
  orders: number;
  /** sales ÷ orders; null with no orders */
  averageOrder: number | null;
}

/**
 * The home page's figures (dashboard recommendation 2): the last 7 days
 * against the 7 before — a fair comparison at any hour, unlike "today",
 * which is ₦0 every morning — with today so far, and what's owed.
 */
export interface WeekFigures {
  current: PeriodFigures;
  previous: PeriodFigures;
  /** placed today so far (Lagos), not cancelled */
  todaySales: number;
  todayOrders: number;
  /** the 7 days' orders by where they came from */
  byChannel: { channel: string; count: number }[];
  /**
   * Owed to the business now: orders on a trade buyer's account (21.5) and
   * unpaid invoices, less what's been recorded — and how much of it is past
   * due. The same two sources as Reports → Money owed.
   */
  owed: { total: number; overdue: number };
}

/**
 * What sold best in the last 7 days (dashboard recommendation 3), counted as
 * Reports → Top products counts it: each product's lines on orders placed in
 * the period, cancelled ones left out, at the price charged.
 */
export interface TopProductsWeek {
  rows: { productId: string | null; name: string; unitsSold: number; revenue: number; shareRatio: number }[];
  /** different products sold in the 7 days */
  productCount: number;
}

/** One day of the home page's sales chart, and the same weekday-position 30 days earlier. */
export interface TrendDay {
  /** YYYY-MM-DD, Lagos */
  day: string;
  sales: number;
  orders: number;
  /** the matching day of the 30 before */
  previousDay: string;
  previousSales: number;
}

/**
 * The last 30 days of sales against the 30 before (the home page's chart).
 * Counted exactly as Reports → Sales counts them, so the two never disagree:
 * every order placed on the day, at its total, cancelled ones left out.
 */
export interface SalesTrend {
  days: TrendDay[];
  total: number;
  orders: number;
  previousTotal: number;
}

export interface DashboardOverview {
  organizationName: string;
  currency: string;
  canViewSales: boolean;
  canViewInventory: boolean;
  /** null wherever the member may not see that part of the business. */
  sales: {
    openOrders: number;
    returnsAwaiting: number;
    unansweredQuestions: number;
    overdueInvoices: number;
    /**
     * Orders cancelled after they were paid and not refunded in full — a
     * cancellation, or a payment that arrived after its stock was gone (or
     * would now ship from dearer stores than the customer paid for).
     */
    refundsOwed: number;
    /** chargebacks not yet settled — 2 means "more than one" (only two are read) */
    openDisputes: number;
    firstDisputeOrderId: string | null;
  } | null;
  inventory: {
    lowStockCount: number;
  } | null;
  recentOrders: RecentOrder[];
  /** null when the member may not see sales */
  trend: SalesTrend | null;
  /** null when the member may not see sales */
  week: WeekFigures | null;
  /** null when the member may not see sales */
  topProducts: TopProductsWeek | null;
  /**
   * What stands between this shop and taking online payments (ROADMAP 10.8),
   * for members who can change settings — null when nothing does, or when the
   * member couldn't act on it anyway.
   */
  onlinePayments: OnlinePaymentBlocker | null;
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const ctx = await getOrganizationContext();
  const organizationId = ctx.organization.id;
  const perms = ctx.membership.role.permissions;
  const canViewSales = hasPermission(perms, PERMISSIONS.SALES_VIEW);
  const canViewInventory = hasPermission(perms, PERMISSIONS.INVENTORY_VIEW);
  const canEditSettings = hasPermission(perms, PERMISSIONS.SETTINGS_EDIT);

  const [sales, inventory, recentOrders, readiness, trend, week, topProducts] = await Promise.all([
    canViewSales ? salesSnapshot(organizationId) : Promise.resolve(null),
    canViewInventory ? inventorySnapshot(organizationId) : Promise.resolve(null),
    canViewSales ? recentOrdersFor(organizationId) : Promise.resolve([]),
    canEditSettings ? getOnlinePaymentReadiness(organizationId) : Promise.resolve(null),
    canViewSales ? salesTrend(organizationId) : Promise.resolve(null),
    canViewSales ? weekFigures(organizationId) : Promise.resolve(null),
    canViewSales ? topProductsWeek(organizationId) : Promise.resolve(null),
  ]);

  return {
    organizationName: ctx.organization.name,
    currency: ctx.organization.currency,
    canViewSales,
    canViewInventory,
    onlinePayments: readiness?.blocker ?? null,
    sales,
    inventory,
    recentOrders,
    trend,
    week,
    topProducts,
  };
}

/** Exported for the test; the page reads it through getDashboardOverview. */
export async function topProductsWeek(organizationId: string, now: Date = new Date(), limit = 5): Promise<TopProductsWeek> {
  const period = resolvePeriod({ range: '7d' }, now);
  const where = Prisma.sql`
    o."organizationId" = ${organizationId}
    AND o."status" <> 'CANCELLED'
    AND o."placedAt" >= ${period.from}
    AND o."placedAt" < ${period.to}
  `;
  // A deleted product has no id left, so its lines are kept apart by name.
  const product = Prisma.sql`COALESCE(li."productId", 'deleted:' || li."name")`;
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<{ product_id: string | null; name: string; units: bigint | null; revenue: Prisma.Decimal | null }[]>`
      SELECT MAX(li."productId") AS product_id,
             MAX(li."name") AS name,
             SUM(li."quantity") AS units,
             SUM(li."totalPrice") AS revenue
        FROM "order_line_items" li
        JOIN "orders" o ON o."id" = li."orderId"
       WHERE ${where}
       GROUP BY ${product}
       ORDER BY revenue DESC, units DESC, name ASC
       LIMIT ${limit}
    `,
    prisma.$queryRaw<{ products: bigint; revenue: Prisma.Decimal | null }[]>`
      SELECT COUNT(DISTINCT ${product}) AS products, COALESCE(SUM(li."totalPrice"), 0) AS revenue
        FROM "order_line_items" li
        JOIN "orders" o ON o."id" = li."orderId"
       WHERE ${where}
    `,
  ]);
  const ids = rows.map((row) => row.product_id).filter((id): id is string => Boolean(id));
  const items = ids.length
    ? await prisma.inventoryItem.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true } })
    : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const total = Number(totals[0]?.revenue ?? 0);
  return {
    rows: rows.map((row) => {
      const item = row.product_id ? byId.get(row.product_id) : undefined;
      const revenue = Number(row.revenue ?? 0);
      return {
        productId: item?.id ?? null,
        // Today's name when the product still exists; the name it sold under otherwise.
        name: item?.name ?? row.name,
        unitsSold: Number(row.units ?? 0),
        revenue,
        shareRatio: total > 0 ? revenue / total : 0,
      };
    }),
    productCount: Number(totals[0]?.products ?? 0),
  };
}

const UNPAID_INVOICE = ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/** Exported for the test; the page reads it through getDashboardOverview. */
export async function weekFigures(organizationId: string, now: Date = new Date()): Promise<WeekFigures> {
  const period = resolvePeriod({ range: '7d' }, now);
  const before = previousPeriod(period);
  const counted = (from: Date, to: Date) => ({ organizationId, status: { not: 'CANCELLED' as const }, placedAt: { gte: from, lt: to } });
  const today = startOfTodayInLagos();

  const [current, previous, todaySales, byChannel, owedOrders, overdueOrders, owedInvoices, overdueInvoices] = await Promise.all([
    prisma.order.aggregate({ where: counted(period.from, period.to), _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.order.aggregate({ where: counted(before.from, before.to), _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.order.aggregate({ where: counted(today, period.to), _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ['channel'], where: counted(period.from, period.to), _count: { _all: true } }),
    // What's owed: totals less what's been recorded, summed as two columns.
    prisma.order.aggregate({
      where: { organizationId, paymentStatus: 'ON_ACCOUNT', status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true, accountPaidAmount: true },
    }),
    prisma.order.aggregate({
      where: { organizationId, paymentStatus: 'ON_ACCOUNT', status: { not: 'CANCELLED' }, accountDueAt: { lt: now } },
      _sum: { totalAmount: true, accountPaidAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { organizationId, status: { in: [...UNPAID_INVOICE] } },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { organizationId, status: { in: [...UNPAID_INVOICE] }, dueDate: { lt: now } },
      _sum: { totalAmount: true, paidAmount: true },
    }),
  ]);

  const figures = (agg: { _sum: { totalAmount: Prisma.Decimal | null }; _count: { _all: number } }): PeriodFigures => {
    const sales = Number(agg._sum.totalAmount ?? 0);
    const orders = agg._count._all;
    return { sales, orders, averageOrder: orders > 0 ? Math.round((sales / orders) * 100) / 100 : null };
  };
  const left = (total: Prisma.Decimal | null, paid: Prisma.Decimal | null) => Math.max(0, Number(total ?? 0) - Number(paid ?? 0));
  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    current: figures(current),
    previous: figures(previous),
    todaySales: Number(todaySales._sum.totalAmount ?? 0),
    todayOrders: todaySales._count._all,
    byChannel: byChannel.map((g) => ({ channel: g.channel, count: g._count._all })),
    owed: {
      total: round(left(owedOrders._sum.totalAmount, owedOrders._sum.accountPaidAmount) + left(owedInvoices._sum.totalAmount, owedInvoices._sum.paidAmount)),
      overdue: round(left(overdueOrders._sum.totalAmount, overdueOrders._sum.accountPaidAmount) + left(overdueInvoices._sum.totalAmount, overdueInvoices._sum.paidAmount)),
    },
  };
}

/** Exported for the test; the page reads it through getDashboardOverview. */
export async function salesTrend(organizationId: string, now: Date = new Date()): Promise<SalesTrend> {
  const period = resolvePeriod({ range: '30d' }, now);
  const before = previousPeriod(period);
  const rows = await prisma.$queryRaw<{ day: string; orders: bigint; sales: Prisma.Decimal | null }[]>`
    SELECT to_char((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS day,
           COUNT(*) AS orders,
           SUM(o."totalAmount") AS sales
      FROM "orders" o
     WHERE o."organizationId" = ${organizationId}
       AND o."status" <> 'CANCELLED'
       AND o."placedAt" >= ${before.from}
       AND o."placedAt" < ${period.to}
     GROUP BY 1
  `;
  const byDay = new Map(rows.map((row) => [row.day, { sales: Number(row.sales ?? 0), orders: Number(row.orders) }]));
  const span = period.to.getTime() - period.from.getTime();

  const days: TrendDay[] = bucketKeys(period).map((day) => {
    // The same position in the 30 days before: exactly 30 days earlier.
    const previousDay = lagosDay(new Date(new Date(`${day}T12:00:00Z`).getTime() - span));
    return {
      day,
      sales: byDay.get(day)?.sales ?? 0,
      orders: byDay.get(day)?.orders ?? 0,
      previousDay,
      previousSales: byDay.get(previousDay)?.sales ?? 0,
    };
  });
  return {
    days,
    total: days.reduce((sum, d) => sum + d.sales, 0),
    orders: days.reduce((sum, d) => sum + d.orders, 0),
    previousTotal: days.reduce((sum, d) => sum + d.previousSales, 0),
  };
}

async function salesSnapshot(organizationId: string) {
  const [
    openOrders,
    returnsAwaiting,
    unansweredQuestions,
    overdueInvoices,
    refundsOwed,
    openDisputes,
  ] = await Promise.all([
      /* Only an online order can be "waiting on you" — a counter sale is
       * finished the moment it is rung up. */
      prisma.order.count({ where: { organizationId, status: { in: [...OPEN_ORDER_STATUSES] } } }),
      prisma.orderReturn.count({ where: { organizationId, status: 'REQUESTED' } }),
      prisma.productQuestion.count({ where: { organizationId, status: 'PENDING' } }),
      prisma.invoice.count({
        where: {
          organizationId,
          status: { in: ['SENT', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
        },
      }),
      prisma.order.count({
        where: { organizationId, status: 'CANCELLED', paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
      }),
      /* Chargebacks still open (ROADMAP 10.5) — oldest first, so a single one
       * can be linked to directly. */
      prisma.paymentDispute.findMany({
        where: { organizationId, status: { not: 'resolved' } },
        select: { orderId: true },
        orderBy: { createdAt: 'asc' },
        take: 2,
      }),
    ]);

  return {
    openOrders,
    returnsAwaiting,
    unansweredQuestions,
    overdueInvoices,
    refundsOwed,
    openDisputes: openDisputes.length,
    firstDisputeOrderId: openDisputes[0]?.orderId ?? null,
  };
}

async function inventorySnapshot(organizationId: string) {
  /*
   * "Low" is per store: the level's own reorder point when it has one, the
   * product's otherwise, and nothing at all when neither is set. Two columns
   * compared against a third is beyond Prisma's filter language, so this is
   * one counting query rather than every stock row pulled into Node.
   */
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
      FROM "inventory_levels" l
      JOIN "inventory_items" i ON i."id" = l."inventoryItemId"
     WHERE i."organizationId" = ${organizationId}
       AND COALESCE(l."reorderPoint", i."reorderPoint") IS NOT NULL
       AND l."quantity" <= COALESCE(l."reorderPoint", i."reorderPoint")
  `;

  return { lowStockCount: Number(count) };
}

async function recentOrdersFor(organizationId: string): Promise<RecentOrder[]> {
  const orders = await prisma.order.findMany({
    where: { organizationId },
    orderBy: { placedAt: 'desc' },
    take: 8,
    select: {
      id: true,
      reference: true,
      status: true,
      paymentStatus: true,
      firstName: true,
      lastName: true,
      totalAmount: true,
      placedAt: true,
      _count: { select: { lineItems: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    reference: o.reference,
    status: o.status,
    paymentStatus: o.paymentStatus,
    customerName: `${o.firstName} ${o.lastName}`.trim(),
    itemCount: o._count.lineItems,
    totalAmount: Number(o.totalAmount),
    placedAt: o.placedAt.toISOString(),
  }));
}
