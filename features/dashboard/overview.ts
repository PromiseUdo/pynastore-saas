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
  } | null;
  inventory: {
    lowStockCount: number;
  } | null;
  recentOrders: RecentOrder[];
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const ctx = await getOrganizationContext();
  const organizationId = ctx.organization.id;
  const perms = ctx.membership.role.permissions;
  const canViewSales = hasPermission(perms, PERMISSIONS.SALES_VIEW);
  const canViewInventory = hasPermission(perms, PERMISSIONS.INVENTORY_VIEW);

  const since = startOfTodayInLagos();

  const [sales, inventory, recentOrders] = await Promise.all([
    canViewSales ? salesSnapshot(organizationId, since) : Promise.resolve(null),
    canViewInventory ? inventorySnapshot(organizationId) : Promise.resolve(null),
    canViewSales ? recentOrdersFor(organizationId) : Promise.resolve([]),
  ]);

  return {
    organizationName: ctx.organization.name,
    currency: ctx.organization.currency,
    canViewSales,
    canViewInventory,
    sales,
    inventory,
    recentOrders,
  };
}

async function salesSnapshot(organizationId: string, since: Date) {
  const [paidToday, ordersToday, byChannel, openOrders, returnsAwaiting, unansweredQuestions, overdueInvoices] =
    await Promise.all([
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
    ]);

  return {
    revenueToday: Number(paidToday._sum.totalAmount ?? 0),
    ordersToday,
    todayByChannel: byChannel.map((g) => ({ channel: g.channel, count: g._count._all })),
    openOrders,
    returnsAwaiting,
    unansweredQuestions,
    overdueInvoices,
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
