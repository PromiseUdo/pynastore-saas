'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { ItemStatus, MovementType } from '@/lib/generated/prisma/enums';
import { requireStoreAccess } from '@/lib/store-access';
import { type ActionResult, toActionError, computeMovingAverageCost, maybeSendLowStockAlert, getAvailableStock } from './shared';

const StockMovementSchema = z.object({
  inventoryItemId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  toWarehouseId: z.string().cuid().optional(),
  type: z.nativeEnum(MovementType),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

export type MovementRow = {
  id: string;
  type: MovementType;
  quantity: number;
  unitCost: number | null;
  notes: string | null;
  createdAt: Date;
  itemName: string;
  itemSku: string;
  warehouseName: string;
  toWarehouseName: string | null;
  /** the document this came from, e.g. "SalesInvoice" + its id */
  referenceType: string | null;
  referenceId: string | null;
};

export async function createStockMovement(
  input: z.infer<typeof StockMovementSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    // 1. Resolve org context + permissions
    const ctx = await getOrganizationContext();
    requirePermission(
      ctx.membership.role.permissions,
      PERMISSIONS.INVENTORY_MOVEMENT_CREATE,
    );

    // 2. Validate input
    const data = StockMovementSchema.parse(input);

    // 3. Verify the item and warehouse belong to THIS org (critical!)
    const [item, warehouse] = await Promise.all([
      prisma.inventoryItem.findUnique({
        where: { id: data.inventoryItemId },
        select: { id: true, organizationId: true, averageCost: true, reorderPoint: true, name: true, sku: true },
      }),
      prisma.warehouse.findUnique({
        where: { id: data.warehouseId },
        select: { id: true, organizationId: true, name: true },
      }),
    ]);

    if (
      !item ||
      item.organizationId !== ctx.organization.id ||
      !warehouse ||
      warehouse.organizationId !== ctx.organization.id
    ) {
      return { success: false, error: 'Resource not found' };
    }

    /* Where, not just what: a member limited to certain stores may only move
     * stock in those (ROADMAP Phase 8.6). On a transfer this is the store the
     * goods LEAVE — sending stock away is the act being authorised. */
    requireStoreAccess(ctx.membership, data.warehouseId, warehouse.name);

    const existingLevel = await prisma.inventoryLevel.findUnique({
      where: {
        inventoryItemId_warehouseId: {
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.warehouseId,
        },
      },
    });
    const previousQty = existingLevel ? Number(existingLevel.quantity) : 0;

    // 4. For OUT/TRANSFER movements: check sufficient AVAILABLE stock — not raw
    // on-hand, since some of it may already be reserved by an issued invoice
    // awaiting packing (see getAvailableStock's doc comment).
    if (data.type === 'OUT' || data.type === 'TRANSFER') {
      const { available } = await getAvailableStock(prisma, {
        inventoryItemId: data.inventoryItemId,
        warehouseId: data.warehouseId,
      });
      if (available < data.quantity) {
        return { success: false, error: `Insufficient available stock (${available} available, some may be reserved)` };
      }
    }

    // 5. Atomic transaction: create movement + update inventory levels + moving-average cost
    const result = await prisma.$transaction(async (tx) => {
      // a. Create the ledger entry
      const movement = await tx.stockMovement.create({
        data: {
          organizationId: ctx.organization.id,
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.warehouseId,
          toWarehouseId: data.toWarehouseId,
          type: data.type,
          quantity: data.quantity,
          unitCost: data.unitCost,
          notes: data.notes,
          performedById: ctx.userId,
        },
      });

      // b. Update InventoryLevel (materialized current stock)
      const quantityDelta =
        data.type === 'IN' || data.type === 'ADJUSTMENT'
          ? data.quantity
          : -data.quantity;

      await tx.inventoryLevel.upsert({
        where: {
          inventoryItemId_warehouseId: {
            inventoryItemId: data.inventoryItemId,
            warehouseId: data.warehouseId,
          },
        },
        create: {
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.warehouseId,
          quantity: quantityDelta,
        },
        update: {
          quantity: { increment: quantityDelta },
        },
      });

      // c. If TRANSFER: increase quantity in destination warehouse
      if (data.type === 'TRANSFER' && data.toWarehouseId) {
        await tx.inventoryLevel.upsert({
          where: {
            inventoryItemId_warehouseId: {
              inventoryItemId: data.inventoryItemId,
              warehouseId: data.toWarehouseId,
            },
          },
          create: {
            inventoryItemId: data.inventoryItemId,
            warehouseId: data.toWarehouseId,
            quantity: data.quantity,
          },
          update: {
            quantity: { increment: data.quantity },
          },
        });
      }

      // d. On IN with a captured unit cost, roll it into the item's moving-average cost
      if (data.type === 'IN' && data.unitCost !== undefined) {
        const totalsBefore = await tx.inventoryLevel.aggregate({
          where: { inventoryItemId: data.inventoryItemId },
          _sum: { quantity: true },
        });
        const totalQtyBefore = Number(totalsBefore._sum.quantity ?? 0) - data.quantity;
        const newAvgCost = computeMovingAverageCost(
          Number(item.averageCost),
          totalQtyBefore,
          data.quantity,
          data.unitCost,
        );

        await tx.inventoryItem.update({
          where: { id: data.inventoryItemId },
          data: { averageCost: newAvgCost },
        });
      }

      return movement;
    });

    // 6. Audit log (outside transaction — non-blocking)
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: `inventory.stock_movement.${data.type.toLowerCase()}`,
      entityType: 'StockMovement',
      entityId: result.id,
      metadata: {
        type: data.type,
        quantity: data.quantity,
        inventoryItemId: data.inventoryItemId,
        warehouseId: data.warehouseId,
      },
    });

    // 7. Edge-triggered low-stock alert (no background worker in this app —
    // evaluated inline right after the movement that could have crossed the threshold)
    if (data.type === 'OUT' || data.type === 'TRANSFER') {
      const newQty = previousQty - data.quantity;
      const threshold = existingLevel?.reorderPoint
        ? Number(existingLevel.reorderPoint)
        : item.reorderPoint
          ? Number(item.reorderPoint)
          : null;

      await maybeSendLowStockAlert({
        organizationId: ctx.organization.id,
        organizationSlug: ctx.organization.slug,
        itemName: item.name,
        itemSku: item.sku,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        previousQty,
        newQty,
        threshold,
      });
    }

    return { success: true, data: { id: result.id } };
  } catch (err) {
    return toActionError(err, 'An unexpected error occurred');
  }
}

/* ─── Stock in: the everyday "I have this many" entry ─────────────────── */

export type StockUnit = {
  /** the InventoryItem that actually holds stock — a variant, or the product itself */
  id: string;
  label: string;
  sku: string;
  /** stock already recorded, per store */
  byStore: { warehouseId: string; quantity: number }[];
};

export type ProductStockUnits = {
  productId: string;
  productName: string;
  unit: string;
  /** true when stock lives on variants rather than the product row */
  hasVariants: boolean;
  units: StockUnit[];
  /** whether anything has been recorded for this product yet */
  hasStock: boolean;
};

/**
 * What a product's stock can be recorded against. A product with variants
 * holds nothing itself — each variant does — so the "add stock" form asks
 * per variant rather than pretending the parent has a count.
 */
export async function getProductStockUnits(productId: string): Promise<ActionResult<ProductStockUnits>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const product = await prisma.inventoryItem.findFirst({
      where: { id: productId, organizationId: ctx.organization.id, parentItemId: null },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        inventoryLevels: { select: { warehouseId: true, quantity: true } },
        variants: {
          where: { status: { not: ItemStatus.ARCHIVED } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            sku: true,
            variantAttributes: true,
            inventoryLevels: { select: { warehouseId: true, quantity: true } },
          },
        },
      },
    });
    if (!product) return { success: false, error: 'Product not found' };

    const level = (rows: { warehouseId: string; quantity: Prisma.Decimal }[]) =>
      rows.map((r) => ({ warehouseId: r.warehouseId, quantity: Number(r.quantity) }));

    const units: StockUnit[] = product.variants.length
      ? product.variants.map((v) => ({
          id: v.id,
          // "Red / M" reads better in a stock form than the full product name
          label:
            Object.values((v.variantAttributes as Record<string, string> | null) ?? {}).join(' / ') || v.name,
          sku: v.sku,
          byStore: level(v.inventoryLevels),
        }))
      : [{ id: product.id, label: product.name, sku: product.sku, byStore: level(product.inventoryLevels) }];

    return {
      success: true,
      data: {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        hasVariants: product.variants.length > 0,
        units,
        hasStock: units.some((u) => u.byStore.some((s) => s.quantity !== 0)),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load stock');
  }
}

const StockInSchema = z.object({
  warehouseId: z.string().cuid(),
  notes: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        inventoryItemId: z.string().cuid(),
        quantity: z.number().positive(),
        /** what you paid per unit — keeps the running average cost honest */
        unitCost: z.number().nonnegative().optional(),
      }),
    )
    .min(1, 'Enter a quantity for at least one line'),
});

export type StockInInput = z.input<typeof StockInSchema>;

/**
 * Records stock arriving at one store, for several units at once (a product's
 * variants, say). Each line becomes an ordinary IN movement, so average cost,
 * low-stock alerts and the ledger all behave exactly as they do anywhere else.
 */
export async function recordStockIn(input: StockInInput): Promise<ActionResult<{ recorded: number }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_MOVEMENT_CREATE);

    const parsed = StockInSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Please check the form' };
    const data = parsed.data;

    // Lines are written one at a time: a failure part-way leaves the entries
    // that did succeed in place, which is what an append-only ledger should
    // do — and the caller is told how far it got.
    let recorded = 0;
    for (const line of data.lines) {
      const result = await createStockMovement({
        inventoryItemId: line.inventoryItemId,
        warehouseId: data.warehouseId,
        type: MovementType.IN,
        quantity: line.quantity,
        unitCost: line.unitCost,
        notes: data.notes,
      });
      if (!result.success) {
        return {
          success: false,
          error: recorded > 0 ? `${result.error} (${recorded} line${recorded === 1 ? '' : 's'} already saved)` : result.error,
        };
      }
      recorded += 1;
    }

    return { success: true, data: { recorded } };
  } catch (err) {
    return toActionError(err, 'Failed to record stock');
  }
}

export type MovementListParams = {
  /** matches item name, SKU, notes or the document a movement came from */
  q?: string;
  warehouseId?: string;
  inventoryItemId?: string;
  type?: MovementType;
  /** ISO dates (inclusive), as the date inputs produce them */
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
};

export type MovementListResult = {
  rows: MovementRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** movements in the ledger at all — tells "no results" from "nothing recorded yet" */
  ledgerSize: number;
};

/** The stock ledger, newest first. Append-only: nothing here can be edited. */
export async function getStockMovements(params: MovementListParams = {}): Promise<ActionResult<MovementListResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const perPage = Math.min(Math.max(params.perPage ?? 25, 5), 200);
    const q = params.q?.trim();

    // `to` is a date, so include everything up to the end of that day.
    const to = params.to ? new Date(`${params.to}T23:59:59.999`) : undefined;
    const from = params.from ? new Date(`${params.from}T00:00:00`) : undefined;

    const where = {
      organizationId,
      warehouseId: params.warehouseId,
      inventoryItemId: params.inventoryItemId,
      type: params.type,
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(q
        ? {
            OR: [
              { inventoryItem: { name: { contains: q, mode: 'insensitive' as const } } },
              { inventoryItem: { sku: { contains: q, mode: 'insensitive' as const } } },
              { notes: { contains: q, mode: 'insensitive' as const } },
              { referenceId: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, ledgerSize, movements] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.count({ where: { organizationId } }),
      prisma.stockMovement.findMany({
        where,
        select: {
          id: true,
          type: true,
          quantity: true,
          unitCost: true,
          notes: true,
          createdAt: true,
          referenceType: true,
          referenceId: true,
          inventoryItem: { select: { name: true, sku: true } },
          warehouse: { select: { name: true } },
          toWarehouseId: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, params.page ?? 1) - 1) * perPage,
        take: perPage,
      }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(1, params.page ?? 1), pageCount);

    const toWarehouseIds = [...new Set(movements.map((m) => m.toWarehouseId).filter((id): id is string => !!id))];
    const toWarehouses = toWarehouseIds.length
      ? await prisma.warehouse.findMany({ where: { id: { in: toWarehouseIds } }, select: { id: true, name: true } })
      : [];
    const toWarehouseMap = new Map(toWarehouses.map((w) => [w.id, w.name]));

    return {
      success: true,
      data: {
        rows: movements.map((m) => ({
          id: m.id,
          type: m.type,
          quantity: Number(m.quantity),
          unitCost: m.unitCost ? Number(m.unitCost) : null,
          notes: m.notes,
          createdAt: m.createdAt,
          referenceType: m.referenceType,
          referenceId: m.referenceId,
          itemName: m.inventoryItem.name,
          itemSku: m.inventoryItem.sku,
          warehouseName: m.warehouse.name,
          toWarehouseName: m.toWarehouseId ? (toWarehouseMap.get(m.toWarehouseId) ?? null) : null,
        })),
        total,
        page,
        perPage,
        pageCount,
        ledgerSize,
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load stock movements');
  }
}
