'use server';

/*
 * features/inventory/store-detail.ts
 *
 * One store, read from the rows that already own the facts: InventoryLevel for
 * what is on the shelf, StockMovement for what has happened, StockTransfer for
 * what is on its way. Nothing here keeps its own copy of a figure, so this page
 * and the reports it links to cannot disagree (ROADMAP Phase 8).
 *
 * What a store SELLS is deliberately absent — that needs a definition of
 * "sales at a store" (which store filled which line, and what to do with
 * delivery and discounts), and it is settled in Phase 8.5.
 */

import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { ItemStatus, WarehouseStatus } from '@/lib/generated/prisma/enums';
import type { Prisma } from '@/lib/generated/prisma/client';
import { canUseStore } from '@/lib/store-access';
import { type ActionResult, toActionError, variantNameOf } from './shared';

/** Where a level's low-stock threshold came from. */
export type ThresholdSource = 'store' | 'product';

export type StoreDetail = {
  id: string;
  name: string;
  location: string | null;
  status: WarehouseStatus;
  sellsOnline: boolean;
  /** Products with a level at this store, whether or not any stock is on hand. */
  productCount: number;
  unitsOnHand: number;
  /** Held for orders and issued invoices — on the shelf, already promised. */
  unitsHeld: number;
  lowStockCount: number;
  outOfStockCount: number;
  /** On hand × the product's moving-average cost. */
  stockValue: number;
  /** Sent to this store and not yet received. */
  transfersIncoming: number;
  /** Sent from this store and not yet received by the other side. */
  transfersOutgoing: number;
  /** Stock counts still open at this store. */
  openCycleCounts: number;
  /** Whether the signed-in member may change stock here (Phase 8.6). */
  canWorkHere: boolean;
  createdAt: Date;
};

export type StoreStockState = 'in' | 'low' | 'out';

export type StoreInventoryRow = {
  /** The stocked unit: a variant when the product has options, else the product. */
  itemId: string;
  /** The product page to open — the variant's parent, when it is a variant. */
  productId: string;
  name: string;
  /** e.g. "Red · M"; null when the product has no options. */
  variantName: string | null;
  sku: string;
  status: ItemStatus;
  onHand: number;
  held: number;
  available: number;
  /** The threshold in force here, or null when neither store nor product sets one. */
  reorderPoint: number | null;
  reorderPointSource: ThresholdSource | null;
  /** This store's suggested restock quantity, when it has one. */
  reorderQty: number | null;
  location: string | null;
  unitCost: number;
  value: number;
  stockState: StoreStockState;
};

export type StoreInventoryParams = {
  warehouseId: string;
  /** matches product or variant name, SKU, barcode or shelf tag */
  q?: string;
  stock?: StoreStockState;
  sort?: 'name' | 'stock-asc' | 'stock-desc' | 'value-desc';
  page?: number;
  perPage?: number;
};

export type StoreInventoryResult = {
  rows: StoreInventoryRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** Products stocked here at all — tells "no results" from "nothing stocked yet". */
  stockedCount: number;
};

export type StoreActivityRow = {
  id: string;
  type: string;
  quantity: number;
  itemName: string;
  itemSku: string;
  /** True when this movement brought stock INTO the store being looked at. */
  incoming: boolean;
  /** On a transfer, the store at the other end — seen from this store. */
  otherStoreName: string | null;
  notes: string | null;
  referenceType: string | null;
  createdAt: Date;
};

export type StoreTransferRow = {
  id: string;
  itemName: string;
  sku: string;
  quantity: number;
  otherStoreName: string;
  direction: 'in' | 'out';
  dispatchedAt: Date;
};

const num = (value: Prisma.Decimal | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

/** The threshold in force for one level: this store's own beats the product's. */
function thresholdOf(
  levelPoint: number | null,
  itemPoint: number | null,
): { reorderPoint: number | null; source: ThresholdSource | null } {
  if (levelPoint !== null) return { reorderPoint: levelPoint, source: 'store' };
  if (itemPoint !== null) return { reorderPoint: itemPoint, source: 'product' };
  return { reorderPoint: null, source: null };
}

function stateOf(available: number, reorderPoint: number | null): StoreStockState {
  if (available <= 0) return 'out';
  if (reorderPoint !== null && available <= reorderPoint) return 'low';
  return 'in';
}

/**
 * The headline facts for one store. Low stock and out of stock are counted here
 * rather than in SQL because the threshold in force is per level (this store's
 * override, falling back to the product's), which Prisma cannot express — the
 * same reason listProducts derives its stock state in Node.
 */
export async function getStoreDetail(warehouseId: string): Promise<ActionResult<StoreDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const store = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId },
      select: { id: true, name: true, location: true, status: true, sellsOnline: true, createdAt: true },
    });
    if (!store) return { success: false, error: 'Store not found' };

    const [levels, transfersIncoming, transfersOutgoing, openCycleCounts] = await Promise.all([
      prisma.inventoryLevel.findMany({
        where: { warehouseId, inventoryItem: { organizationId, status: { not: ItemStatus.ARCHIVED } } },
        select: {
          quantity: true,
          reservedQty: true,
          reorderPoint: true,
          inventoryItem: { select: { reorderPoint: true, averageCost: true } },
        },
      }),
      prisma.stockTransfer.count({ where: { organizationId, toWarehouseId: warehouseId, status: 'DISPATCHED' } }),
      prisma.stockTransfer.count({ where: { organizationId, fromWarehouseId: warehouseId, status: 'DISPATCHED' } }),
      prisma.cycleCount.count({ where: { organizationId, warehouseId, status: 'OPEN' } }),
    ]);

    let unitsOnHand = 0;
    let unitsHeld = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let stockValue = 0;

    for (const level of levels) {
      const onHand = Number(level.quantity);
      const held = Number(level.reservedQty);
      unitsOnHand += onHand;
      unitsHeld += held;
      stockValue += onHand * Number(level.inventoryItem.averageCost);

      const { reorderPoint } = thresholdOf(num(level.reorderPoint), num(level.inventoryItem.reorderPoint));
      const state = stateOf(onHand - held, reorderPoint);
      if (state === 'out') outOfStockCount += 1;
      else if (state === 'low') lowStockCount += 1;
    }

    return {
      success: true,
      data: {
        ...store,
        productCount: levels.length,
        unitsOnHand,
        unitsHeld,
        lowStockCount,
        outOfStockCount,
        stockValue,
        transfersIncoming,
        transfersOutgoing,
        openCycleCounts,
        canWorkHere: canUseStore(ctx.membership, warehouseId),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load this store');
  }
}

/**
 * What this store holds, one row per stocked unit (a variant where a product
 * has options, since that is what a level is attached to). Filtering by stock
 * state, sorting and paging happen in Node for the reason above: the threshold
 * and the value are derived per row.
 */
export async function getStoreInventory(params: StoreInventoryParams): Promise<ActionResult<StoreInventoryResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const store = await prisma.warehouse.findFirst({
      where: { id: params.warehouseId, organizationId },
      select: { id: true },
    });
    if (!store) return { success: false, error: 'Store not found' };

    const perPage = Math.min(Math.max(params.perPage ?? 25, 5), 100);
    const q = params.q?.trim();

    const where: Prisma.InventoryLevelWhereInput = {
      warehouseId: params.warehouseId,
      inventoryItem: { organizationId, status: { not: ItemStatus.ARCHIVED } },
      ...(q
        ? {
            OR: [
              { location: { contains: q, mode: 'insensitive' } },
              {
                inventoryItem: {
                  organizationId,
                  status: { not: ItemStatus.ARCHIVED },
                  OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { sku: { contains: q, mode: 'insensitive' } },
                    { barcode: { contains: q, mode: 'insensitive' } },
                    { parentItem: { name: { contains: q, mode: 'insensitive' } } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [levels, stockedCount] = await Promise.all([
      prisma.inventoryLevel.findMany({
        where,
        select: {
          quantity: true,
          reservedQty: true,
          reorderPoint: true,
          reorderQty: true,
          location: true,
          inventoryItem: {
            select: {
              id: true,
              name: true,
              sku: true,
              status: true,
              reorderPoint: true,
              averageCost: true,
              parentItemId: true,
              variantAttributes: true,
              parentItem: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.inventoryLevel.count({
        where: {
          warehouseId: params.warehouseId,
          inventoryItem: { organizationId, status: { not: ItemStatus.ARCHIVED } },
        },
      }),
    ]);

    let rows: StoreInventoryRow[] = levels.map((level) => {
      const item = level.inventoryItem;
      const onHand = Number(level.quantity);
      const held = Number(level.reservedQty);
      const available = onHand - held;
      const { reorderPoint, source } = thresholdOf(num(level.reorderPoint), num(item.reorderPoint));
      const unitCost = Number(item.averageCost);
      return {
        itemId: item.id,
        productId: item.parentItem?.id ?? item.id,
        name: item.parentItem?.name ?? item.name,
        variantName: item.parentItemId ? (variantNameOf(item.variantAttributes) ?? item.name) : null,
        sku: item.sku,
        status: item.status,
        onHand,
        held,
        available,
        reorderPoint,
        reorderPointSource: source,
        reorderQty: num(level.reorderQty),
        location: level.location,
        unitCost,
        value: onHand * unitCost,
        stockState: stateOf(available, reorderPoint),
      };
    });

    if (params.stock) rows = rows.filter((r) => r.stockState === params.stock);

    const sort = params.sort ?? 'name';
    rows.sort((a, b) => {
      if (sort === 'stock-asc') return a.available - b.available || a.name.localeCompare(b.name);
      if (sort === 'stock-desc') return b.available - a.available || a.name.localeCompare(b.name);
      if (sort === 'value-desc') return b.value - a.value || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name) || (a.variantName ?? '').localeCompare(b.variantName ?? '');
    });

    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(params.page ?? 1, 1), pageCount);

    return {
      success: true,
      data: {
        rows: rows.slice((page - 1) * perPage, page * perPage),
        total,
        page,
        perPage,
        pageCount,
        stockedCount,
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load this store’s stock');
  }
}

/** The last things that happened to this store's stock, newest first. */
export async function getStoreActivity(warehouseId: string, take = 8): Promise<ActionResult<StoreActivityRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const movements = await prisma.stockMovement.findMany({
      // A transfer out of here and a transfer into here are both this store's news.
      where: { organizationId, OR: [{ warehouseId }, { toWarehouseId: warehouseId }] },
      select: {
        id: true,
        type: true,
        quantity: true,
        notes: true,
        referenceType: true,
        createdAt: true,
        warehouseId: true,
        toWarehouseId: true,
        warehouse: { select: { name: true } },
        inventoryItem: { select: { name: true, sku: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 50),
    });

    const destinationIds = [...new Set(movements.map((m) => m.toWarehouseId).filter((id): id is string => !!id))];
    const destinations = destinationIds.length
      ? await prisma.warehouse.findMany({ where: { id: { in: destinationIds }, organizationId }, select: { id: true, name: true } })
      : [];
    const names = new Map(destinations.map((w) => [w.id, w.name]));

    return {
      success: true,
      data: movements.map((m) => {
        // A transfer recorded against another store, destined here, arrived.
        const incoming = m.toWarehouseId === warehouseId;
        return {
          id: m.id,
          type: m.type,
          quantity: Number(m.quantity),
          itemName: m.inventoryItem.name,
          itemSku: m.inventoryItem.sku,
          incoming,
          otherStoreName: incoming ? m.warehouse.name : m.toWarehouseId ? (names.get(m.toWarehouseId) ?? null) : null,
          notes: m.notes,
          referenceType: m.referenceType,
          createdAt: m.createdAt,
        };
      }),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load this store’s activity');
  }
}

/** Transfers this store is waiting on, in both directions, oldest first. */
export async function getStoreOpenTransfers(warehouseId: string): Promise<ActionResult<StoreTransferRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const transfers = await prisma.stockTransfer.findMany({
      where: {
        organizationId,
        status: 'DISPATCHED',
        OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }],
      },
      select: {
        id: true,
        quantity: true,
        dispatchedAt: true,
        fromWarehouseId: true,
        inventoryItem: { select: { name: true, sku: true } },
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
      },
      orderBy: { dispatchedAt: 'asc' },
      take: 10,
    });

    return {
      success: true,
      data: transfers.map((t) => {
        const incoming = t.fromWarehouseId !== warehouseId;
        return {
          id: t.id,
          itemName: t.inventoryItem.name,
          sku: t.inventoryItem.sku,
          quantity: Number(t.quantity),
          otherStoreName: incoming ? t.fromWarehouse.name : t.toWarehouse.name,
          direction: incoming ? ('in' as const) : ('out' as const),
          dispatchedAt: t.dispatchedAt,
        };
      }),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load this store’s transfers');
  }
}
