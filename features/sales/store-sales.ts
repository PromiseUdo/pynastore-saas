'use server';

/*
 * features/sales/store-sales.ts
 *
 * What a store sells (ROADMAP Phase 8.5).
 *
 * THE DEFINITION, which the screens repeat in plain words rather than hiding:
 *
 *   A store's sales are the GOODS that left its shelf, at the price the
 *   customer was charged for them — `OrderStockAllocation.quantity ×
 *   OrderLineItem.unitPrice`. The allocations already record which store
 *   filled which line (Phase 2), so an order split across two shops is
 *   counted exactly, not apportioned by guesswork.
 *
 *   NOT included: delivery, and an order-level discount code. Both belong to
 *   the order as a whole, not to any one store's shelf — splitting them would
 *   invent a number. A campaign price IS included, because it is the price
 *   actually charged on the line.
 *
 *   Cancelled orders count towards nothing, exactly as Phase 4 settled for
 *   customer metrics (`status <> 'CANCELLED'`), and a released hold is no
 *   store's sale. Returns and refunds are NOT deducted — they are their own
 *   records against the order, and the screens say so.
 *
 * One raw query, on purpose: the figure multiplies a column on the allocation
 * by a column on the line item and groups by store, which Prisma's aggregates
 * cannot express. Parameterised throughout.
 */

import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import type { ActionResult } from './shared';

export interface StoreSalesFigures {
  /** Goods that left this store's shelf, at the price charged. */
  goodsValue: number;
  /** Of that, what the website sold. */
  onlineValue: number;
  /** Of that, what was sold over the counter (WALK_IN and PHONE). */
  counterValue: number;
  unitsSold: number;
  /** Orders this store contributed to — an order split across two stores counts for both. */
  orderCount: number;
}

export interface StoreSalesRow extends StoreSalesFigures {
  warehouseId: string;
  warehouseName: string;
  sellsOnline: boolean;
  isOpen: boolean;
  /** This store's share of the period's attributed goods value, 0–1 (AGENTS §10). */
  shareRatio: number;
}

export interface StoreSalesReport {
  rows: StoreSalesRow[];
  totals: StoreSalesFigures;
  /**
   * Orders in the period that no store can be credited with: nothing was ever
   * held for them, or the whole hold was given back. Shown rather than
   * silently dropped, so the per-store figures and the sales total can be
   * seen not to match.
   */
  unattributed: { orderCount: number; goodsValue: number };
  from: string;
  to: string;
}

type Row = {
  warehouse_id: string;
  goods_value: Prisma.Decimal | null;
  online_value: Prisma.Decimal | null;
  counter_value: Prisma.Decimal | null;
  units: Prisma.Decimal | null;
  orders: bigint;
};

const n = (value: Prisma.Decimal | bigint | number | null): number => (value === null ? 0 : Number(value));

/** The per-store aggregate, for one store or all of them. */
async function readShares(params: {
  organizationId: string;
  from: Date;
  to: Date;
  warehouseId?: string;
}): Promise<Row[]> {
  const storeFilter = params.warehouseId ? Prisma.sql`AND a."warehouseId" = ${params.warehouseId}` : Prisma.empty;

  return prisma.$queryRaw<Row[]>`
    SELECT a."warehouseId" AS warehouse_id,
           SUM(a."quantity" * li."unitPrice") AS goods_value,
           SUM(CASE WHEN o."channel" = 'ONLINE' THEN a."quantity" * li."unitPrice" ELSE 0 END) AS online_value,
           SUM(CASE WHEN o."channel" <> 'ONLINE' THEN a."quantity" * li."unitPrice" ELSE 0 END) AS counter_value,
           SUM(a."quantity") AS units,
           COUNT(DISTINCT o."id") AS orders
    FROM "order_stock_allocations" a
    JOIN "order_line_items" li ON li."id" = a."orderLineItemId"
    JOIN "orders" o ON o."id" = a."orderId"
    WHERE a."organizationId" = ${params.organizationId}
      AND a."status" <> 'RELEASED'
      AND o."status" <> 'CANCELLED'
      AND o."placedAt" >= ${params.from}
      AND o."placedAt" < ${params.to}
      ${storeFilter}
    GROUP BY a."warehouseId"
  `;
}

function figuresOf(row: Row | undefined): StoreSalesFigures {
  return {
    goodsValue: n(row?.goods_value ?? null),
    onlineValue: n(row?.online_value ?? null),
    counterValue: n(row?.counter_value ?? null),
    unitsSold: n(row?.units ?? null),
    orderCount: row ? Number(row.orders) : 0,
  };
}

/**
 * One store's takings for a window. `to` is exclusive, so a caller passing
 * midnight tomorrow gets today.
 */
export async function getStoreSales(params: {
  warehouseId: string;
  from: Date;
  to: Date;
}): Promise<ActionResult<StoreSalesFigures>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;

    const store = await prisma.warehouse.findFirst({
      where: { id: params.warehouseId, organizationId },
      select: { id: true },
    });
    if (!store) return { success: false, error: 'Store not found' };

    const rows = await readShares({ organizationId, from: params.from, to: params.to, warehouseId: params.warehouseId });
    return { success: true, data: figuresOf(rows[0]) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load this store’s sales' };
  }
}

/**
 * Every store side by side, biggest seller first — including the ones that
 * sold nothing, because "nothing" is the answer a merchant is looking for.
 */
export async function getSalesByStore(params: { from: Date; to: Date }): Promise<ActionResult<StoreSalesReport>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;

    const [shares, warehouses, unattributed] = await Promise.all([
      readShares({ organizationId, from: params.from, to: params.to }),
      prisma.warehouse.findMany({
        where: { organizationId },
        select: { id: true, name: true, sellsOnline: true, status: true },
        orderBy: { name: 'asc' },
      }),
      prisma.$queryRaw<{ orders: bigint; goods_value: Prisma.Decimal | null }[]>`
        SELECT COUNT(*) AS orders, COALESCE(SUM(o."subtotal"), 0) AS goods_value
        FROM "orders" o
        WHERE o."organizationId" = ${organizationId}
          AND o."status" <> 'CANCELLED'
          AND o."placedAt" >= ${params.from}
          AND o."placedAt" < ${params.to}
          AND NOT EXISTS (
            SELECT 1 FROM "order_stock_allocations" a
            WHERE a."orderId" = o."id" AND a."status" <> 'RELEASED'
          )
      `,
    ]);

    const byStore = new Map(shares.map((row) => [row.warehouse_id, row]));
    const totals = shares.reduce<StoreSalesFigures>(
      (sum, row) => {
        const figures = figuresOf(row);
        return {
          goodsValue: sum.goodsValue + figures.goodsValue,
          onlineValue: sum.onlineValue + figures.onlineValue,
          counterValue: sum.counterValue + figures.counterValue,
          unitsSold: sum.unitsSold + figures.unitsSold,
          // An order split across two stores must not be counted twice here.
          orderCount: sum.orderCount,
        };
      },
      { goodsValue: 0, onlineValue: 0, counterValue: 0, unitsSold: 0, orderCount: 0 },
    );

    const distinctOrders = await prisma.order.count({
      where: {
        organizationId,
        status: { not: 'CANCELLED' },
        placedAt: { gte: params.from, lt: params.to },
        allocations: { some: { status: { not: 'RELEASED' } } },
      },
    });
    totals.orderCount = distinctOrders;

    const rows: StoreSalesRow[] = warehouses
      .map((warehouse) => {
        const figures = figuresOf(byStore.get(warehouse.id));
        return {
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          sellsOnline: warehouse.sellsOnline,
          isOpen: warehouse.status === 'ACTIVE',
          ...figures,
          shareRatio: totals.goodsValue > 0 ? figures.goodsValue / totals.goodsValue : 0,
        };
      })
      .sort((a, b) => b.goodsValue - a.goodsValue || a.warehouseName.localeCompare(b.warehouseName));

    return {
      success: true,
      data: {
        rows,
        totals,
        unattributed: {
          orderCount: Number(unattributed[0]?.orders ?? 0),
          goodsValue: n(unattributed[0]?.goods_value ?? null),
        },
        from: params.from.toISOString(),
        to: params.to.toISOString(),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load sales by store' };
  }
}
