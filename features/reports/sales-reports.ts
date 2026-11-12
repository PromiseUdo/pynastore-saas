'use server';

/*
 * features/reports/sales-reports.ts
 *
 * The reports hub (ROADMAP 14.6): what the business sold, day by day and by
 * channel; which products and customers it came from; and what discounts and
 * campaigns gave away to get it. "Which store sells" is
 * features/sales/store-sales.ts, shown in the same hub.
 *
 * THE DEFINITIONS, which the screens repeat in plain words:
 *
 *   - An order counts on the day it was PLACED (a Lagos day), whichever
 *     channel it came from — the website, the counter or the phone. Cancelled
 *     orders count towards nothing, as everywhere else in the app.
 *   - "Sales" is what customers were charged: the order total, so after any
 *     discount, with delivery, and with VAT inside it (14.1). Orders not paid
 *     yet (pay on delivery, a transfer waiting) are included and their value
 *     is shown on its own, so the figure is never mistaken for cash.
 *   - Refunds are NOT deducted. They're their own records, counted on the day
 *     they were recorded and shown beside the sales.
 *   - A product's figure is its lines — units × the price charged, campaign
 *     prices included. A discount code or a counter discount belongs to the
 *     whole order, so it isn't spread over the products.
 *
 * Raw queries where the figure groups by a Lagos day or by an expression
 * Prisma can't group by; parameterised throughout, and every one names the
 * organisation from the session — never from the browser.
 */

import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { getOrganizationEntitlements, hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { campaignMechanicLabel } from '@/lib/marketing/campaign-rules';
import { measureCampaign } from '@/lib/marketing/campaign-performance';
import { formatMoney } from '@/lib/format';
import { bucketKeys, previousPeriod, resolvePeriod, type BucketUnit } from '@/lib/reports/period';
import { toActionError, type ActionResult } from '@/features/sales/shared';

/** What a report's URL may carry; resolved on the server, whatever it says. */
export interface PeriodInput {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}

/** The longest lists the hub shows — the top of each, not the whole history. */
const TOP_ROWS = 50;

const n = (value: Prisma.Decimal | bigint | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

const UNPAID = ['AWAITING_PAYMENT', 'AWAITING_TRANSFER', 'DUE_ON_DELIVERY', 'FAILED'] as const;

/** The Lagos day or month an order was placed in, for GROUP BY. */
function bucketSql(unit: BucketUnit): Prisma.Sql {
  const format = unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  return Prisma.sql`to_char((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos', ${format})`;
}

async function salesContext() {
  const ctx = await getOrganizationContext();
  requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
  return ctx;
}

// ── Sales by day and channel ─────────────────────────────────────────────

export interface ChannelFigures {
  online: number;
  inStore: number;
  phone: number;
}

export interface RevenueBucket extends ChannelFigures {
  /** YYYY-MM-DD or YYYY-MM, Lagos */
  key: string;
  sales: number;
  orders: number;
}

export interface RevenueReport {
  unit: BucketUnit;
  buckets: RevenueBucket[];
  totals: {
    sales: number;
    orders: number;
    /** null with no orders: there's no average of nothing */
    averageOrder: number | null;
    byChannel: ChannelFigures;
    ordersByChannel: ChannelFigures;
    /** what discount codes and counter discounts took off */
    discounts: number;
    delivery: number;
    /** VAT included in the sales above (only a VAT-registered shop has any) */
    vat: number;
    /** of the sales, what hasn't been paid yet */
    unpaid: number;
    /** refunds recorded in the period, whichever order they were for */
    refunds: number;
  };
  /** the same number of days just before, for comparison */
  previous: { sales: number; orders: number };
}

type ChannelKey = keyof ChannelFigures;
const CHANNEL_KEY: Record<string, ChannelKey> = { ONLINE: 'online', WALK_IN: 'inStore', PHONE: 'phone' };

export async function getRevenueReport(input: PeriodInput): Promise<ActionResult<RevenueReport>> {
  try {
    const ctx = await salesContext();
    const organizationId = ctx.organization.id;
    const period = resolvePeriod(input);
    const before = previousPeriod(period);

    const counted = (from: Date, to: Date): Prisma.OrderWhereInput => ({
      organizationId,
      status: { not: 'CANCELLED' },
      placedAt: { gte: from, lt: to },
    });

    const [rows, sums, unpaid, refunds, previous] = await Promise.all([
      prisma.$queryRaw<{ bucket: string; channel: string; orders: bigint; sales: Prisma.Decimal | null }[]>`
        SELECT ${bucketSql(period.unit)} AS bucket,
               o."channel"::text AS channel,
               COUNT(*) AS orders,
               SUM(o."totalAmount") AS sales
          FROM "orders" o
         WHERE o."organizationId" = ${organizationId}
           AND o."status" <> 'CANCELLED'
           AND o."placedAt" >= ${period.from}
           AND o."placedAt" < ${period.to}
         GROUP BY 1, 2
      `,
      prisma.order.aggregate({
        where: counted(period.from, period.to),
        _sum: { discount: true, deliveryFee: true, taxAmount: true },
      }),
      prisma.order.aggregate({
        where: { ...counted(period.from, period.to), paymentStatus: { in: [...UNPAID] } },
        _sum: { totalAmount: true },
      }),
      prisma.orderRefund.aggregate({
        where: { organizationId, createdAt: { gte: period.from, lt: period.to } },
        _sum: { amount: true },
      }),
      prisma.order.aggregate({
        where: counted(before.from, before.to),
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    const empty = (key: string): RevenueBucket => ({ key, sales: 0, orders: 0, online: 0, inStore: 0, phone: 0 });
    const byKey = new Map(bucketKeys(period).map((key) => [key, empty(key)]));
    const byChannel: ChannelFigures = { online: 0, inStore: 0, phone: 0 };
    const ordersByChannel: ChannelFigures = { online: 0, inStore: 0, phone: 0 };
    let sales = 0;
    let orders = 0;

    for (const row of rows) {
      const channel = CHANNEL_KEY[row.channel];
      if (!channel) continue;
      const bucket = byKey.get(row.bucket) ?? empty(row.bucket);
      byKey.set(row.bucket, bucket);
      const value = n(row.sales);
      const count = Number(row.orders);
      bucket[channel] += value;
      bucket.sales += value;
      bucket.orders += count;
      byChannel[channel] += value;
      ordersByChannel[channel] += count;
      sales += value;
      orders += count;
    }

    return {
      success: true,
      data: {
        unit: period.unit,
        buckets: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
        totals: {
          sales,
          orders,
          averageOrder: orders > 0 ? sales / orders : null,
          byChannel,
          ordersByChannel,
          discounts: n(sums._sum.discount),
          delivery: n(sums._sum.deliveryFee),
          vat: n(sums._sum.taxAmount),
          unpaid: n(unpaid._sum.totalAmount),
          refunds: n(refunds._sum.amount),
        },
        previous: { sales: n(previous._sum.totalAmount), orders: previous._count._all },
      },
    };
  } catch (error) {
    return toActionError(error, 'We couldn’t load your sales');
  }
}

// ── Top products ─────────────────────────────────────────────────────────

export interface TopProductRow {
  /** null for a product that has since been deleted */
  productId: string | null;
  name: string;
  sku: string | null;
  unitsSold: number;
  revenue: number;
  onlineRevenue: number;
  orders: number;
  /** this product's part of all goods sold in the period, 0–1 */
  shareRatio: number;
}

export interface TopProductsReport {
  rows: TopProductRow[];
  /** how many different products sold — the list stops at the top 50 */
  productCount: number;
  totals: { revenue: number; unitsSold: number };
}

export async function getTopProductsReport(input: PeriodInput): Promise<ActionResult<TopProductsReport>> {
  try {
    const ctx = await salesContext();
    const organizationId = ctx.organization.id;
    const period = resolvePeriod(input);

    const where = Prisma.sql`
      o."organizationId" = ${organizationId}
      AND o."status" <> 'CANCELLED'
      AND o."placedAt" >= ${period.from}
      AND o."placedAt" < ${period.to}
    `;
    // A deleted product has no id left, so its lines are kept apart by name.
    const product = Prisma.sql`COALESCE(li."productId", 'deleted:' || li."name")`;

    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<
        {
          product_id: string | null;
          name: string;
          units: bigint | null;
          revenue: Prisma.Decimal | null;
          online: Prisma.Decimal | null;
          orders: bigint;
        }[]
      >`
        SELECT MAX(li."productId") AS product_id,
               MAX(li."name") AS name,
               SUM(li."quantity") AS units,
               SUM(li."totalPrice") AS revenue,
               SUM(CASE WHEN o."channel" = 'ONLINE' THEN li."totalPrice" ELSE 0 END) AS online,
               COUNT(DISTINCT o."id") AS orders
          FROM "order_line_items" li
          JOIN "orders" o ON o."id" = li."orderId"
         WHERE ${where}
         GROUP BY ${product}
         ORDER BY revenue DESC, units DESC, name ASC
         LIMIT ${TOP_ROWS}
      `,
      prisma.$queryRaw<{ products: bigint; revenue: Prisma.Decimal | null; units: bigint | null }[]>`
        SELECT COUNT(DISTINCT ${product}) AS products,
               COALESCE(SUM(li."totalPrice"), 0) AS revenue,
               COALESCE(SUM(li."quantity"), 0) AS units
          FROM "order_line_items" li
          JOIN "orders" o ON o."id" = li."orderId"
         WHERE ${where}
      `,
    ]);

    const ids = rows.map((r) => r.product_id).filter((id): id is string => Boolean(id));
    const items = ids.length
      ? await prisma.inventoryItem.findMany({
          where: { id: { in: ids }, organizationId },
          select: { id: true, name: true, sku: true },
        })
      : [];
    const itemById = new Map(items.map((item) => [item.id, item]));
    const totalRevenue = n(totals[0]?.revenue);

    return {
      success: true,
      data: {
        rows: rows.map((row) => {
          const item = row.product_id ? itemById.get(row.product_id) : undefined;
          const revenue = n(row.revenue);
          return {
            productId: item ? item.id : null,
            // Today's name when the product still exists; the name it sold under otherwise.
            name: item?.name ?? row.name,
            sku: item?.sku ?? null,
            unitsSold: n(row.units),
            revenue,
            onlineRevenue: n(row.online),
            orders: Number(row.orders),
            shareRatio: totalRevenue > 0 ? revenue / totalRevenue : 0,
          };
        }),
        productCount: Number(totals[0]?.products ?? 0),
        totals: { revenue: totalRevenue, unitsSold: n(totals[0]?.units) },
      },
    };
  } catch (error) {
    return toActionError(error, 'We couldn’t load your top products');
  }
}

// ── Top customers ────────────────────────────────────────────────────────

export interface TopCustomerRow {
  customerId: string;
  name: string;
  email: string | null;
  orders: number;
  spend: number;
  lastOrderAt: string;
  /** their first order ever was in this period */
  isNew: boolean;
}

export interface TopCustomersReport {
  rows: TopCustomerRow[];
  /** customers who bought in the period */
  customerCount: number;
  newCustomers: number;
  /** of those, who ordered more than once in the period */
  repeatCustomers: number;
  /** counter sales nobody took a name for — real sales, no one to rank */
  anonymous: { orders: number; spend: number };
}

export async function getTopCustomersReport(input: PeriodInput): Promise<ActionResult<TopCustomersReport>> {
  try {
    const ctx = await salesContext();
    // Names and emails: the same permission the customer list needs.
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_VIEW);
    const organizationId = ctx.organization.id;
    const period = resolvePeriod(input);

    const inPeriod = Prisma.sql`
      o."organizationId" = ${organizationId}
      AND o."status" <> 'CANCELLED'
      AND o."placedAt" >= ${period.from}
      AND o."placedAt" < ${period.to}
    `;
    /* Each customer's first order EVER (not cancelled), to tell a new
     * customer from a returning one. */
    const firsts = Prisma.sql`
      firsts AS (
        SELECT f."customerId" AS cid, MIN(f."placedAt") AS first_order
          FROM "orders" f
         WHERE f."organizationId" = ${organizationId}
           AND f."status" <> 'CANCELLED'
           AND f."customerId" IS NOT NULL
         GROUP BY f."customerId"
      )
    `;

    const [rows, summary, anonymous] = await Promise.all([
      prisma.$queryRaw<
        { cid: string; orders: bigint; spend: Prisma.Decimal | null; last_order: Date; first_order: Date }[]
      >`
        WITH ${firsts}
        SELECT o."customerId" AS cid,
               COUNT(*) AS orders,
               SUM(o."totalAmount") AS spend,
               MAX(o."placedAt") AS last_order,
               MIN(fi.first_order) AS first_order
          FROM "orders" o
          JOIN firsts fi ON fi.cid = o."customerId"
         WHERE ${inPeriod}
         GROUP BY o."customerId"
         ORDER BY spend DESC, orders DESC, last_order DESC
         LIMIT ${TOP_ROWS}
      `,
      prisma.$queryRaw<{ customers: bigint; new_customers: bigint; repeat: bigint }[]>`
        WITH ${firsts},
        buyers AS (
          SELECT o."customerId" AS cid, COUNT(*) AS orders
            FROM "orders" o
           WHERE ${inPeriod} AND o."customerId" IS NOT NULL
           GROUP BY o."customerId"
        )
        SELECT COUNT(*) AS customers,
               COUNT(*) FILTER (WHERE fi.first_order >= ${period.from}) AS new_customers,
               COUNT(*) FILTER (WHERE b.orders >= 2) AS repeat
          FROM buyers b
          JOIN firsts fi ON fi.cid = b.cid
      `,
      prisma.order.aggregate({
        where: {
          organizationId,
          status: { not: 'CANCELLED' },
          placedAt: { gte: period.from, lt: period.to },
          customerId: null,
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    const customers = rows.length
      ? await prisma.customer.findMany({
          where: { id: { in: rows.map((r) => r.cid) }, organizationId },
          select: { id: true, name: true, email: true },
        })
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return {
      success: true,
      data: {
        rows: rows.flatMap((row) => {
          const customer = customerById.get(row.cid);
          if (!customer) return [];
          return [
            {
              customerId: customer.id,
              name: customer.name,
              email: customer.email,
              orders: Number(row.orders),
              spend: n(row.spend),
              lastOrderAt: row.last_order.toISOString(),
              isNew: row.first_order >= period.from,
            },
          ];
        }),
        customerCount: Number(summary[0]?.customers ?? 0),
        newCustomers: Number(summary[0]?.new_customers ?? 0),
        repeatCustomers: Number(summary[0]?.repeat ?? 0),
        anonymous: { orders: anonymous._count._all, spend: n(anonymous._sum.totalAmount) },
      },
    };
  } catch (error) {
    return toActionError(error, 'We couldn’t load your top customers');
  }
}

// ── Discounts and campaigns ──────────────────────────────────────────────

export interface DiscountCodeRow {
  /** null when the code has since been deleted */
  discountCodeId: string | null;
  code: string;
  label: string | null;
  campaignName: string | null;
  orders: number;
  /** what the code took off those orders */
  discountGiven: number;
  /** what those orders came to, after the discount */
  sales: number;
}

export interface CampaignReportRow {
  campaignId: string;
  name: string;
  offer: string;
  startsAt: string;
  endsAt: string | null;
  /** still running now */
  isRunning: boolean;
  orders: number;
  unitsSold: number;
  revenue: number;
  discountGiven: number;
  codeRedemptions: number;
}

export interface DiscountsReport {
  codes: DiscountCodeRow[];
  /** whole-sale discounts given at the counter, which have no code */
  counter: { orders: number; discountGiven: number };
  campaigns: CampaignReportRow[];
  totals: {
    /** codes + counter discounts — what came off order totals */
    orderDiscounts: number;
    /** what campaign prices gave away below the usual price */
    campaignDiscounts: number;
    ordersWithCode: number;
  };
}

export async function getDiscountsReport(input: PeriodInput): Promise<ActionResult<DiscountsReport>> {
  try {
    const ctx = await salesContext();
    const { plan } = await getOrganizationEntitlements();
    if (!hasFeature(plan, FEATURES.REPORTS_ADVANCED)) {
      return { success: false, error: 'Discount and campaign reports come with Advanced reports' };
    }
    const organizationId = ctx.organization.id;
    const period = resolvePeriod(input);
    const now = new Date();

    const [codeRows, counter, campaigns] = await Promise.all([
      prisma.$queryRaw<
        {
          code_id: string | null;
          code: string;
          label: string | null;
          orders: bigint;
          given: Prisma.Decimal | null;
          sales: Prisma.Decimal | null;
        }[]
      >`
        SELECT MAX(o."discountCodeId") AS code_id,
               MAX(o."discountCode") AS code,
               MAX(o."discountCodeLabel") AS label,
               COUNT(*) AS orders,
               SUM(o."discount") AS given,
               SUM(o."totalAmount") AS sales
          FROM "orders" o
         WHERE o."organizationId" = ${organizationId}
           AND o."status" <> 'CANCELLED'
           AND o."placedAt" >= ${period.from}
           AND o."placedAt" < ${period.to}
           AND o."discountCode" IS NOT NULL
         GROUP BY COALESCE(o."discountCodeId", 'deleted:' || o."discountCode")
         ORDER BY given DESC, orders DESC, code ASC
      `,
      prisma.order.aggregate({
        where: {
          organizationId,
          status: { not: 'CANCELLED' },
          placedAt: { gte: period.from, lt: period.to },
          discountCode: null,
          discount: { gt: 0 },
        },
        _sum: { discount: true },
        _count: { _all: true },
      }),
      // Campaigns that were running at some point inside the period.
      prisma.campaign.findMany({
        where: {
          organizationId,
          status: 'SCHEDULED',
          startsAt: { lt: period.to, lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: period.from } }],
        },
        orderBy: { startsAt: 'desc' },
        take: TOP_ROWS,
        select: {
          id: true,
          name: true,
          mechanic: true,
          value: true,
          startsAt: true,
          endsAt: true,
          prices: { select: { inventoryItemId: true, originalPrice: true } },
          discountCodes: { select: { id: true } },
        },
      }),
    ]);

    const liveCodeIds = codeRows.map((r) => r.code_id).filter((id): id is string => Boolean(id));
    const liveCodes = liveCodeIds.length
      ? await prisma.discountCode.findMany({
          where: { id: { in: liveCodeIds }, organizationId },
          select: { id: true, campaign: { select: { name: true } } },
        })
      : [];
    const campaignOfCode = new Map(liveCodes.map((c) => [c.id, c.campaign?.name ?? null]));
    const ordersByCode = new Map(codeRows.map((r) => [r.code_id, Number(r.orders)]));

    const campaignRows = await Promise.all(
      campaigns.map(async (campaign): Promise<CampaignReportRow> => {
        // Only the part of its window inside the period (both ends inclusive).
        const from = campaign.startsAt > period.from ? campaign.startsAt : period.from;
        const windowEnd = campaign.endsAt ?? now;
        const periodEnd = new Date(period.to.getTime() - 1);
        const to = windowEnd < periodEnd ? windowEnd : periodEnd;
        const redemptions = campaign.discountCodes.reduce((sum, code) => sum + (ordersByCode.get(code.id) ?? 0), 0);
        const measured = await measureCampaign(
          organizationId,
          from,
          to,
          campaign.prices.map((p) => ({ id: p.inventoryItemId, originalPrice: Number(p.originalPrice) })),
          redemptions,
        );
        return {
          campaignId: campaign.id,
          name: campaign.name,
          offer: campaignMechanicLabel(campaign.mechanic, Number(campaign.value), (amount) => formatMoney(amount)),
          startsAt: campaign.startsAt.toISOString(),
          endsAt: campaign.endsAt?.toISOString() ?? null,
          isRunning: !campaign.endsAt || campaign.endsAt > now,
          orders: measured.orders,
          unitsSold: measured.unitsSold,
          revenue: measured.revenue,
          discountGiven: measured.discountGiven,
          codeRedemptions: measured.codeRedemptions,
        };
      }),
    );

    const codes: DiscountCodeRow[] = codeRows.map((row) => ({
      discountCodeId: row.code_id && campaignOfCode.has(row.code_id) ? row.code_id : null,
      code: row.code,
      label: row.label,
      campaignName: row.code_id ? (campaignOfCode.get(row.code_id) ?? null) : null,
      orders: Number(row.orders),
      discountGiven: n(row.given),
      sales: n(row.sales),
    }));
    const codeDiscounts = codes.reduce((sum, row) => sum + row.discountGiven, 0);
    const counterDiscounts = n(counter._sum.discount);

    return {
      success: true,
      data: {
        codes,
        counter: { orders: counter._count._all, discountGiven: counterDiscounts },
        campaigns: campaignRows,
        totals: {
          orderDiscounts: codeDiscounts + counterDiscounts,
          campaignDiscounts: campaignRows.reduce((sum, row) => sum + row.discountGiven, 0),
          ordersWithCode: codes.reduce((sum, row) => sum + row.orders, 0),
        },
      },
    };
  } catch (error) {
    return toActionError(error, 'We couldn’t load your discounts');
  }
}
