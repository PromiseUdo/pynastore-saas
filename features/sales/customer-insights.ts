'use server';

/*
 * features/sales/customer-insights.ts
 *
 * Who your customers are, and what they're worth.
 *
 * The list used to be every customer in the workspace, unpaginated, showing
 * a count of quotes and invoices — which told a shop owner nothing about the
 * person. What they actually want to know is: how often do they buy, what
 * have they spent, when were they last here, and are they drifting away.
 *
 * ONE RAW QUERY, on purpose. Those figures are aggregates over orders, and
 * the list can be sorted and filtered BY them ("show me my best customers",
 * "who hasn't been back in three months"). Prisma can't express a filter on
 * an aggregate of a relation, so doing this through the query builder would
 * mean loading every customer and their orders into Node and sorting there —
 * exactly the thing that stops working when the shop grows. The SQL below is
 * parameterised throughout; nothing from the browser reaches it as text.
 *
 * Money is major units, like everywhere else in the admin.
 */
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import {
  INACTIVE_AFTER_DAYS,
  isCustomerSegment as isSegment,
  isCustomerSort as isSort,
  type CustomerSegment,
  type CustomerSort,
} from '@/lib/sales/customer-segments';
import type { ActionResult } from './shared';

const PER_PAGE = 25;

/* Cancelled orders are somebody changing their mind, not custom. They are
 * left out of every figure here, which is why "spend" can be lower than the
 * order history suggests. */
const COUNTED_ORDERS = Prisma.sql`o."status" <> 'CANCELLED'`;

export interface CustomerListFilters {
  q?: string;
  segment?: string;
  sort?: string;
  page?: number;
}

export interface CustomerListRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  tags: string[];
  marketingConsent: boolean;
  createdAt: string;
  orderCount: number;
  totalSpend: number;
  averageOrder: number;
  lastOrderAt: string | null;
  returnCount: number;
}

export interface CustomerListResult {
  rows: CustomerListRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** customers before any filter — "none yet" vs "none match" */
  historySize: number;
  /** headline figures for the whole customer base, not just this page */
  summary: { customers: number; withOrders: number; totalSpend: number; repeat: number };
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to view customers' };
  }
  console.error(`[customers] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** The per-customer aggregates every query here builds on. */
function statsCte(organizationId: string) {
  return Prisma.sql`
    WITH stats AS (
      SELECT o."customerId"      AS cid,
             COUNT(*)::int       AS order_count,
             SUM(o."totalAmount") AS spend,
             MAX(o."placedAt")   AS last_order
        FROM "orders" o
       WHERE o."organizationId" = ${organizationId}
         AND o."customerId" IS NOT NULL
         AND ${COUNTED_ORDERS}
       GROUP BY o."customerId"
    ),
    returns AS (
      SELECT o."customerId" AS cid, COUNT(*)::int AS return_count
        FROM "order_returns" r
        JOIN "orders" o ON o."id" = r."orderId"
       WHERE o."organizationId" = ${organizationId}
         AND o."customerId" IS NOT NULL
       GROUP BY o."customerId"
    )
  `;
}

function segmentClause(segment: CustomerSegment | undefined, now: Date): Prisma.Sql {
  const inactiveCutoff = new Date(now.getTime() - INACTIVE_AFTER_DAYS * 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  switch (segment) {
    case 'repeat':
      return Prisma.sql`AND COALESCE(s.order_count, 0) >= 2`;
    case 'inactive':
      // Has bought before, but not lately. Someone who never bought is a
      // different problem and has its own segment.
      return Prisma.sql`AND s.last_order IS NOT NULL AND s.last_order < ${inactiveCutoff}`;
    case 'new':
      return Prisma.sql`AND c."createdAt" >= ${monthStart}`;
    case 'has-returns':
      return Prisma.sql`AND COALESCE(rt.return_count, 0) > 0`;
    case 'never-ordered':
      return Prisma.sql`AND s.cid IS NULL`;
    case 'consented':
      return Prisma.sql`AND c."marketingConsent" = true`;
    default:
      return Prisma.empty;
  }
}

function orderClause(sort: CustomerSort): Prisma.Sql {
  switch (sort) {
    case 'orders':
      return Prisma.sql`ORDER BY COALESCE(s.order_count, 0) DESC, c."name" ASC`;
    case 'recent':
      return Prisma.sql`ORDER BY s.last_order DESC NULLS LAST, c."name" ASC`;
    case 'name':
      return Prisma.sql`ORDER BY c."name" ASC`;
    case 'spend':
    default:
      return Prisma.sql`ORDER BY COALESCE(s.spend, 0) DESC, c."name" ASC`;
  }
}

type RawRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  tags: string[];
  marketingConsent: boolean;
  createdAt: Date;
  order_count: number;
  spend: Prisma.Decimal | null;
  last_order: Date | null;
  return_count: number;
};

function toRow(row: RawRow): CustomerListRow {
  const spend = row.spend === null ? 0 : Number(row.spend);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    tags: row.tags ?? [],
    marketingConsent: row.marketingConsent,
    createdAt: row.createdAt.toISOString(),
    orderCount: row.order_count ?? 0,
    totalSpend: spend,
    averageOrder: row.order_count ? spend / row.order_count : 0,
    lastOrderAt: row.last_order?.toISOString() ?? null,
    returnCount: row.return_count ?? 0,
  };
}

export async function listCustomerInsights(
  filters: CustomerListFilters = {},
): Promise<ActionResult<CustomerListResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_VIEW);
    const organizationId = ctx.organization.id;

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const segment = isSegment(filters.segment) ? filters.segment : undefined;
    const sort = isSort(filters.sort) ? filters.sort : 'spend';
    const q = filters.q?.trim();
    const now = new Date();

    const search = q
      ? Prisma.sql`AND (c."name" ILIKE ${`%${q}%`} OR c."email" ILIKE ${`%${q}%`} OR c."phone" ILIKE ${`%${q}%`})`
      : Prisma.empty;

    /* A merged record is not a customer any more — it is a signpost to the
     * one it became. It never appears in a list, a search or a count. */
    const base = Prisma.sql`
      FROM "customers" c
      LEFT JOIN stats s   ON s.cid = c."id"
      LEFT JOIN returns rt ON rt.cid = c."id"
      WHERE c."organizationId" = ${organizationId}
        AND c."mergedIntoId" IS NULL
        ${search}
        ${segmentClause(segment, now)}
    `;

    const [rows, counted, summary] = await Promise.all([
      prisma.$queryRaw<RawRow[]>`
        ${statsCte(organizationId)}
        SELECT c."id", c."name", c."email", c."phone", c."status", c."tags",
               c."marketingConsent", c."createdAt",
               COALESCE(s.order_count, 0) AS order_count,
               s.spend,
               s.last_order,
               COALESCE(rt.return_count, 0) AS return_count
        ${base}
        ${orderClause(sort)}
        LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}
      `,
      prisma.$queryRaw<{ count: bigint }[]>`
        ${statsCte(organizationId)}
        SELECT COUNT(*)::bigint AS count ${base}
      `,
      prisma.$queryRaw<{ customers: bigint; with_orders: bigint; spend: Prisma.Decimal | null; repeat: bigint }[]>`
        ${statsCte(organizationId)}
        SELECT COUNT(*)::bigint                                              AS customers,
               COUNT(s.cid)::bigint                                          AS with_orders,
               COALESCE(SUM(s.spend), 0)                                     AS spend,
               COUNT(*) FILTER (WHERE COALESCE(s.order_count, 0) >= 2)::bigint AS repeat
          FROM "customers" c
          LEFT JOIN stats s ON s.cid = c."id"
         WHERE c."organizationId" = ${organizationId}
           AND c."mergedIntoId" IS NULL
      `,
    ]);

    const total = Number(counted[0]?.count ?? 0);
    const head = summary[0];

    return {
      success: true,
      data: {
        rows: rows.map(toRow),
        total,
        page,
        perPage: PER_PAGE,
        pageCount: Math.max(1, Math.ceil(total / PER_PAGE)),
        historySize: Number(head?.customers ?? 0),
        summary: {
          customers: Number(head?.customers ?? 0),
          withOrders: Number(head?.with_orders ?? 0),
          totalSpend: head?.spend === null || head?.spend === undefined ? 0 : Number(head.spend),
          repeat: Number(head?.repeat ?? 0),
        },
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your customers');
  }
}

/**
 * Every customer the current filters match, for the spreadsheet — not just
 * the page on screen.
 */
export async function exportCustomerInsights(
  filters: CustomerListFilters = {},
): Promise<ActionResult<CustomerListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_VIEW);
    const organizationId = ctx.organization.id;

    const segment = isSegment(filters.segment) ? filters.segment : undefined;
    const sort = isSort(filters.sort) ? filters.sort : 'spend';
    const q = filters.q?.trim();
    const now = new Date();

    const search = q
      ? Prisma.sql`AND (c."name" ILIKE ${`%${q}%`} OR c."email" ILIKE ${`%${q}%`} OR c."phone" ILIKE ${`%${q}%`})`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<RawRow[]>`
      ${statsCte(organizationId)}
      SELECT c."id", c."name", c."email", c."phone", c."status", c."tags",
             c."marketingConsent", c."createdAt",
             COALESCE(s.order_count, 0) AS order_count,
             s.spend,
             s.last_order,
             COALESCE(rt.return_count, 0) AS return_count
        FROM "customers" c
        LEFT JOIN stats s   ON s.cid = c."id"
        LEFT JOIN returns rt ON rt.cid = c."id"
       WHERE c."organizationId" = ${organizationId}
         AND c."mergedIntoId" IS NULL
         ${search}
         ${segmentClause(segment, now)}
      ${orderClause(sort)}
      LIMIT 5000
    `;

    return { success: true, data: rows.map(toRow) };
  } catch (error) {
    return failure(error, 'We couldn’t prepare your download');
  }
}
