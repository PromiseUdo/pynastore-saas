'use server';

import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { type ActionResult, toActionError } from './shared';

export type StockLevelRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
};

export async function getStockLevelsReport(warehouseId?: string): Promise<ActionResult<StockLevelRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const levels = await prisma.inventoryLevel.findMany({
      where: {
        warehouseId,
        inventoryItem: { organizationId: ctx.organization.id },
      },
      select: {
        quantity: true,
        warehouseId: true,
        warehouse: { select: { name: true } },
        inventoryItem: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { inventoryItem: { name: 'asc' } },
    });

    return {
      success: true,
      data: levels.map((l) => ({
        itemId: l.inventoryItem.id,
        itemName: l.inventoryItem.name,
        sku: l.inventoryItem.sku,
        warehouseId: l.warehouseId,
        warehouseName: l.warehouse.name,
        quantity: Number(l.quantity),
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load stock levels report');
  }
}

export type ValuationRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  averageCost: number;
  value: number;
};

export type ValuationReport = {
  rows: ValuationRow[];
  totalValue: number;
};

export async function getStockValuationReport(warehouseId?: string): Promise<ActionResult<ValuationReport>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const levels = await prisma.inventoryLevel.findMany({
      where: {
        warehouseId,
        inventoryItem: { organizationId: ctx.organization.id },
      },
      select: {
        quantity: true,
        warehouseId: true,
        warehouse: { select: { name: true } },
        inventoryItem: { select: { id: true, name: true, sku: true, averageCost: true } },
      },
      orderBy: { inventoryItem: { name: 'asc' } },
    });

    const rows = levels.map((l) => {
      const quantity = Number(l.quantity);
      const averageCost = Number(l.inventoryItem.averageCost);
      return {
        itemId: l.inventoryItem.id,
        itemName: l.inventoryItem.name,
        sku: l.inventoryItem.sku,
        warehouseId: l.warehouseId,
        warehouseName: l.warehouse.name,
        quantity,
        averageCost,
        value: quantity * averageCost,
      };
    });

    return {
      success: true,
      data: {
        rows,
        totalValue: rows.reduce((sum, r) => sum + r.value, 0),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load valuation report');
  }
}

export type LowStockRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  reorderPoint: number;
  reorderQty: number | null;
  preferredSupplierId: string | null;
};

/**
 * Resolves org context + INVENTORY_VIEW itself (safe to export from this
 * 'use server' file, and safe for other feature modules — e.g.
 * features/procurement/auto-reorder.ts — to call directly): every store
 * level at or below its reorder threshold, for the caller's org.
 */
export async function getLowStockLevels(warehouseId?: string): Promise<ActionResult<LowStockRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const levels = await prisma.inventoryLevel.findMany({
      where: {
        warehouseId,
        inventoryItem: { organizationId: ctx.organization.id },
      },
      select: {
        quantity: true,
        reorderPoint: true,
        reorderQty: true,
        warehouseId: true,
        warehouse: { select: { name: true } },
        inventoryItem: {
          select: { id: true, name: true, sku: true, reorderPoint: true, preferredSupplierId: true },
        },
      },
    });

    const rows: LowStockRow[] = [];
    for (const l of levels) {
      const threshold = l.reorderPoint ? Number(l.reorderPoint) : l.inventoryItem.reorderPoint ? Number(l.inventoryItem.reorderPoint) : null;
      if (threshold === null) continue;
      const quantity = Number(l.quantity);
      if (quantity <= threshold) {
        rows.push({
          itemId: l.inventoryItem.id,
          itemName: l.inventoryItem.name,
          sku: l.inventoryItem.sku,
          warehouseId: l.warehouseId,
          warehouseName: l.warehouse.name,
          quantity,
          reorderPoint: threshold,
          reorderQty: l.reorderQty ? Number(l.reorderQty) : null,
          preferredSupplierId: l.inventoryItem.preferredSupplierId,
        });
      }
    }
    rows.sort((a, b) => a.quantity - a.reorderPoint - (b.quantity - b.reorderPoint));

    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err, 'Failed to load low stock report');
  }
}

export async function getLowStockReport(warehouseId?: string): Promise<ActionResult<LowStockRow[]>> {
  return getLowStockLevels(warehouseId);
}

export type AgingRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  lastActivityAt: Date | null;
  daysSinceLastActivity: number | null;
  isAging: boolean;
};

const AGING_THRESHOLD_DAYS = 90;

export async function getAgingInventoryReport(warehouseId?: string): Promise<ActionResult<AgingRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const levels = await prisma.inventoryLevel.findMany({
      where: {
        warehouseId,
        quantity: { gt: 0 },
        inventoryItem: { organizationId: ctx.organization.id },
      },
      select: {
        quantity: true,
        warehouseId: true,
        warehouse: { select: { name: true } },
        inventoryItem: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { inventoryItem: { name: 'asc' } },
    });

    const lastActivity = await prisma.stockMovement.groupBy({
      by: ['inventoryItemId', 'warehouseId'],
      where: { organizationId: ctx.organization.id },
      _max: { createdAt: true },
    });
    const lastActivityMap = new Map(
      lastActivity.map((a) => [`${a.inventoryItemId}:${a.warehouseId}`, a._max.createdAt]),
    );

    const now = Date.now();
    const rows: AgingRow[] = levels.map((l) => {
      const lastActivityAt = lastActivityMap.get(`${l.inventoryItem.id}:${l.warehouseId}`) ?? null;
      const daysSinceLastActivity = lastActivityAt ? Math.floor((now - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)) : null;
      return {
        itemId: l.inventoryItem.id,
        itemName: l.inventoryItem.name,
        sku: l.inventoryItem.sku,
        warehouseId: l.warehouseId,
        warehouseName: l.warehouse.name,
        quantity: Number(l.quantity),
        lastActivityAt,
        daysSinceLastActivity,
        isAging: daysSinceLastActivity !== null && daysSinceLastActivity >= AGING_THRESHOLD_DAYS,
      };
    });

    rows.sort((a, b) => (b.daysSinceLastActivity ?? Infinity) - (a.daysSinceLastActivity ?? Infinity));

    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err, 'Failed to load aging inventory report');
  }
}

export type SellThroughRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  unitsReceived: number;
  unitsSold: number;
  /** 0–1, not a percentage — multiply for display */
  sellThroughRate: number | null;
};

export async function getSellThroughReport(filters?: {
  warehouseId?: string;
  sinceDays?: number;
}): Promise<ActionResult<SellThroughRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const sinceDays = filters?.sinceDays ?? 30;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const [received, sold] = await Promise.all([
      prisma.stockMovement.groupBy({
        by: ['inventoryItemId', 'warehouseId'],
        where: {
          organizationId: ctx.organization.id,
          warehouseId: filters?.warehouseId,
          type: 'IN',
          createdAt: { gte: since },
        },
        _sum: { quantity: true },
      }),
      prisma.stockMovement.groupBy({
        by: ['inventoryItemId', 'warehouseId'],
        where: {
          organizationId: ctx.organization.id,
          warehouseId: filters?.warehouseId,
          type: 'OUT',
          referenceType: 'Invoice',
          createdAt: { gte: since },
        },
        _sum: { quantity: true },
      }),
    ]);

    const receivedMap = new Map(received.map((r) => [`${r.inventoryItemId}:${r.warehouseId}`, Number(r._sum.quantity ?? 0)]));
    const soldMap = new Map(sold.map((s) => [`${s.inventoryItemId}:${s.warehouseId}`, Number(s._sum.quantity ?? 0)]));

    const keys = new Set([...receivedMap.keys(), ...soldMap.keys()]);
    if (keys.size === 0) return { success: true, data: [] };

    const itemIds = [...new Set([...keys].map((k) => k.split(':')[0]))];
    const warehouseIds = [...new Set([...keys].map((k) => k.split(':')[1]))];
    const [items, warehouses] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, sku: true } }),
      prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } }),
    ]);
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

    const rows: SellThroughRow[] = [...keys].flatMap((key) => {
      const [itemId, whId] = key.split(':');
      const item = itemMap.get(itemId);
      const warehouse = warehouseMap.get(whId);
      if (!item || !warehouse) return [];
      const unitsReceived = receivedMap.get(key) ?? 0;
      const unitsSold = soldMap.get(key) ?? 0;
      return [
        {
          itemId,
          itemName: item.name,
          sku: item.sku,
          warehouseId: whId,
          warehouseName: warehouse.name,
          unitsReceived,
          unitsSold,
          sellThroughRate: unitsReceived > 0 ? unitsSold / unitsReceived : null,
        },
      ];
    });

    rows.sort((a, b) => (b.sellThroughRate ?? -1) - (a.sellThroughRate ?? -1));

    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err, 'Failed to load sell-through report');
  }
}

export type ProfitabilityRow = {
  itemId: string;
  itemName: string;
  sku: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  margin: number;
  /** 0–1, not a percentage — multiply for display */
  marginRatio: number | null;
};

export type ProfitabilityReport = {
  rows: ProfitabilityRow[];
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
};

/**
 * Uses Invoice.createdAt as the "sale date" — this app has no separate
 * issued-at timestamp, and invoices are typically issued shortly after
 * creation. Only lines with a unitCost snapshot count (set by
 * features/sales/invoices.ts:issueInvoice — DRAFT lines never get one).
 */
export async function getProfitabilityReport(filters?: {
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<ActionResult<ProfitabilityReport>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const lineItems = await prisma.invoiceLineItem.findMany({
      where: {
        unitCost: { not: null },
        inventoryItemId: { not: null },
        invoice: {
          organizationId: ctx.organization.id,
          createdAt: {
            gte: filters?.dateFrom,
            lte: filters?.dateTo,
          },
        },
      },
      select: {
        quantity: true,
        unitPrice: true,
        unitCost: true,
        inventoryItemId: true,
        inventoryItem: { select: { name: true, sku: true } },
      },
    });

    const byItem = new Map<string, { itemName: string; sku: string; unitsSold: number; revenue: number; cost: number }>();
    for (const li of lineItems) {
      const itemId = li.inventoryItemId!;
      const qty = Number(li.quantity);
      const revenue = qty * Number(li.unitPrice);
      const cost = qty * Number(li.unitCost);
      const existing = byItem.get(itemId);
      if (existing) {
        existing.unitsSold += qty;
        existing.revenue += revenue;
        existing.cost += cost;
      } else {
        byItem.set(itemId, {
          itemName: li.inventoryItem!.name,
          sku: li.inventoryItem!.sku,
          unitsSold: qty,
          revenue,
          cost,
        });
      }
    }

    const rows: ProfitabilityRow[] = [...byItem.entries()].map(([itemId, v]) => {
      const margin = v.revenue - v.cost;
      return {
        itemId,
        itemName: v.itemName,
        sku: v.sku,
        unitsSold: v.unitsSold,
        revenue: v.revenue,
        cost: v.cost,
        margin,
        marginRatio: v.revenue > 0 ? margin / v.revenue : null,
      };
    });
    rows.sort((a, b) => b.margin - a.margin);

    return {
      success: true,
      data: {
        rows,
        totalRevenue: rows.reduce((sum, r) => sum + r.revenue, 0),
        totalCost: rows.reduce((sum, r) => sum + r.cost, 0),
        totalMargin: rows.reduce((sum, r) => sum + r.margin, 0),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load profitability report');
  }
}
