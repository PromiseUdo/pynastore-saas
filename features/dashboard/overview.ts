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
    revenueToday: number;
    ordersToday: number;
    /** today's orders split by where they came from */
    todayByChannel: { channel: string; count: number }[];
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

  const since = startOfTodayInLagos();

  const [sales, inventory, recentOrders, readiness, trend] = await Promise.all([
    canViewSales ? salesSnapshot(organizationId, since) : Promise.resolve(null),
    canViewInventory ? inventorySnapshot(organizationId) : Promise.resolve(null),
    canViewSales ? recentOrdersFor(organizationId) : Promise.resolve([]),
    canEditSettings ? getOnlinePaymentReadiness(organizationId) : Promise.resolve(null),
    canViewSales ? salesTrend(organizationId) : Promise.resolve(null),
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

async function salesSnapshot(organizationId: string, since: Date) {
  const [
    paidToday,
    ordersToday,
    byChannel,
    openOrders,
    returnsAwaiting,
    unansweredQuestions,
    overdueInvoices,
    refundsOwed,
    openDisputes,
  ] = await Promise.all([
      /* Money counts from the moment it actually arrived, not from when the
       * order was placed — an unpaid order is not revenue. */
      prisma.order.aggregate({
        where: { organizationId, paidAt: { gte: since } },
        _sum: { totalAmount: true },
      }),
      prisma.order.count({ where: { organizationId, placedAt: { gte: since } } }),
      prisma.order.groupBy({
        by: ['channel'],
        where: { organizationId, placedAt: { gte: since } },
        _count: { _all: true },
      }),
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
    revenueToday: Number(paidToday._sum.totalAmount ?? 0),
    ordersToday,
    todayByChannel: byChannel.map((g) => ({ channel: g.channel, count: g._count._all })),
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
