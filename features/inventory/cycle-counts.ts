'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { CycleCountStatus } from '@/lib/generated/prisma/enums';
import { requireStoreAccess } from '@/lib/store-access';
import { type ActionResult, toActionError, maybeSendLowStockAlert } from './shared';

export type CycleCountListRow = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  status: CycleCountStatus;
  itemCount: number;
  createdAt: Date;
  completedAt: Date | null;
};

export type CycleCountItemRow = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  sku: string;
  expectedQty: number;
  countedQty: number | null;
  variance: number | null;
};

export type CycleCountDetail = CycleCountListRow & {
  notes: string | null;
  items: CycleCountItemRow[];
};

const CreateCycleCountSchema = z.object({
  warehouseId: z.string().cuid(),
  itemIds: z.array(z.string().cuid()).min(1, 'Select at least one item to count'),
  notes: z.string().max(500).optional(),
});

export async function createCycleCount(
  input: z.infer<typeof CreateCycleCountSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE);

    const data = CreateCycleCountSchema.parse(input);

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: data.warehouseId },
      select: { organizationId: true, name: true },
    });
    if (!warehouse || warehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }

    // Counting a shelf changes what the system believes is on it, so it is a
    // write in that store (ROADMAP Phase 8.6).
    requireStoreAccess(ctx.membership, data.warehouseId, warehouse.name);

    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: data.itemIds }, organizationId: ctx.organization.id },
      select: { id: true },
    });
    if (items.length !== new Set(data.itemIds).size) {
      return { success: false, error: 'One or more items were not found' };
    }

    const levels = await prisma.inventoryLevel.findMany({
      where: { warehouseId: data.warehouseId, inventoryItemId: { in: data.itemIds } },
      select: { inventoryItemId: true, quantity: true },
    });
    const levelMap = new Map(levels.map((l) => [l.inventoryItemId, Number(l.quantity)]));

    const cycleCount = await prisma.cycleCount.create({
      data: {
        organizationId: ctx.organization.id,
        warehouseId: data.warehouseId,
        notes: data.notes,
        startedById: ctx.userId,
        items: {
          create: data.itemIds.map((itemId) => ({
            inventoryItemId: itemId,
            expectedQty: levelMap.get(itemId) ?? 0,
          })),
        },
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.cycle_count.created',
      entityType: 'CycleCount',
      entityId: cycleCount.id,
      metadata: { warehouseId: data.warehouseId, itemCount: data.itemIds.length },
    });

    return { success: true, data: { id: cycleCount.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create cycle count');
  }
}

export async function listCycleCounts(warehouseId?: string): Promise<ActionResult<CycleCountListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const counts = await prisma.cycleCount.findMany({
      where: { organizationId: ctx.organization.id, warehouseId },
      select: {
        id: true,
        warehouseId: true,
        warehouse: { select: { name: true } },
        status: true,
        completedAt: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: counts.map((c) => ({
        id: c.id,
        warehouseId: c.warehouseId,
        warehouseName: c.warehouse.name,
        status: c.status,
        itemCount: c._count.items,
        createdAt: c.createdAt,
        completedAt: c.completedAt,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load cycle counts');
  }
}

export async function getCycleCount(cycleCountId: string): Promise<ActionResult<CycleCountDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const count = await prisma.cycleCount.findUnique({
      where: { id: cycleCountId },
      include: {
        warehouse: { select: { name: true } },
        items: { include: { inventoryItem: { select: { name: true, sku: true } } } },
      },
    });

    if (!count || count.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Cycle count not found' };
    }

    return {
      success: true,
      data: {
        id: count.id,
        warehouseId: count.warehouseId,
        warehouseName: count.warehouse.name,
        status: count.status,
        notes: count.notes,
        itemCount: count.items.length,
        createdAt: count.createdAt,
        completedAt: count.completedAt,
        items: count.items.map((i) => {
          const countedQty = i.countedQty !== null ? Number(i.countedQty) : null;
          const expectedQty = Number(i.expectedQty);
          return {
            id: i.id,
            inventoryItemId: i.inventoryItemId,
            itemName: i.inventoryItem.name,
            sku: i.inventoryItem.sku,
            expectedQty,
            countedQty,
            variance: countedQty !== null ? countedQty - expectedQty : null,
          };
        }),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load cycle count');
  }
}

const RecordCountsSchema = z.object({
  counts: z.array(z.object({ cycleCountItemId: z.string().cuid(), countedQty: z.number().nonnegative() })).min(1),
});

export async function recordCounts(
  cycleCountId: string,
  input: z.infer<typeof RecordCountsSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE);

    const data = RecordCountsSchema.parse(input);

    const count = await prisma.cycleCount.findUnique({
      where: { id: cycleCountId },
      select: { organizationId: true, status: true, warehouseId: true, items: { select: { id: true } } },
    });
    if (!count || count.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Cycle count not found' };
    }
    if (count.status !== CycleCountStatus.OPEN) {
      return { success: false, error: 'This cycle count is no longer open' };
    }
    requireStoreAccess(ctx.membership, count.warehouseId);
    const itemIds = new Set(count.items.map((i) => i.id));
    if (data.counts.some((c) => !itemIds.has(c.cycleCountItemId))) {
      return { success: false, error: 'One or more items do not belong to this cycle count' };
    }

    await prisma.$transaction(
      data.counts.map((c) =>
        prisma.cycleCountItem.update({
          where: { id: c.cycleCountItemId },
          data: { countedQty: c.countedQty },
        }),
      ),
    );

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to save counted quantities');
  }
}

export async function cancelCycleCount(cycleCountId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE);

    const count = await prisma.cycleCount.findUnique({
      where: { id: cycleCountId },
      select: { organizationId: true, status: true, warehouseId: true },
    });
    if (!count || count.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Cycle count not found' };
    }
    if (count.status !== CycleCountStatus.OPEN) {
      return { success: false, error: 'Only open cycle counts can be cancelled' };
    }
    requireStoreAccess(ctx.membership, count.warehouseId);

    await prisma.cycleCount.update({
      where: { id: cycleCountId },
      data: { status: CycleCountStatus.CANCELLED },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.cycle_count.cancelled',
      entityType: 'CycleCount',
      entityId: cycleCountId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to cancel cycle count');
  }
}

export async function completeCycleCount(cycleCountId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE);

    const count = await prisma.cycleCount.findUnique({
      where: { id: cycleCountId },
      include: {
        warehouse: { select: { name: true } },
        items: { include: { inventoryItem: { select: { name: true, sku: true, reorderPoint: true } } } },
      },
    });
    if (!count || count.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Cycle count not found' };
    }
    if (count.status !== CycleCountStatus.OPEN) {
      return { success: false, error: 'This cycle count is no longer open' };
    }
    requireStoreAccess(ctx.membership, count.warehouseId, count.warehouse.name);
    if (count.items.some((i) => i.countedQty === null)) {
      return { success: false, error: 'Enter a counted quantity for every item before completing' };
    }

    // Re-read current levels — stock may have moved since the snapshot was taken.
    const currentLevels = await prisma.inventoryLevel.findMany({
      where: {
        warehouseId: count.warehouseId,
        inventoryItemId: { in: count.items.map((i) => i.inventoryItemId) },
      },
    });
    const currentLevelMap = new Map(currentLevels.map((l) => [l.inventoryItemId, l]));

    const alerts: { itemName: string; itemSku: string; previousQty: number; newQty: number; threshold: number | null }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const item of count.items) {
        const expectedQty = Number(item.expectedQty);
        const countedQty = Number(item.countedQty);
        const variance = countedQty - expectedQty;
        if (variance === 0) continue;

        const level = currentLevelMap.get(item.inventoryItemId);
        const currentQty = level ? Number(level.quantity) : 0;

        if (variance < 0 && currentQty < Math.abs(variance)) {
          throw new Error(
            `Stock for "${item.inventoryItem.name}" has changed since this count started — recount before completing.`,
          );
        }

        await tx.stockMovement.create({
          data: {
            organizationId: ctx.organization.id,
            inventoryItemId: item.inventoryItemId,
            warehouseId: count.warehouseId,
            type: variance > 0 ? 'ADJUSTMENT' : 'OUT',
            quantity: Math.abs(variance),
            referenceType: 'CycleCount',
            referenceId: cycleCountId,
            performedById: ctx.userId,
          },
        });

        await tx.inventoryLevel.upsert({
          where: {
            inventoryItemId_warehouseId: { inventoryItemId: item.inventoryItemId, warehouseId: count.warehouseId },
          },
          create: { inventoryItemId: item.inventoryItemId, warehouseId: count.warehouseId, quantity: variance },
          update: { quantity: { increment: variance } },
        });

        if (variance < 0) {
          const threshold = level?.reorderPoint
            ? Number(level.reorderPoint)
            : item.inventoryItem.reorderPoint
              ? Number(item.inventoryItem.reorderPoint)
              : null;
          alerts.push({
            itemName: item.inventoryItem.name,
            itemSku: item.inventoryItem.sku,
            previousQty: currentQty,
            newQty: currentQty + variance,
            threshold,
          });
        }
      }

      await tx.cycleCount.update({
        where: { id: cycleCountId },
        data: { status: CycleCountStatus.COMPLETED, completedById: ctx.userId, completedAt: new Date() },
      });
    });

    for (const alert of alerts) {
      await maybeSendLowStockAlert({
        organizationId: ctx.organization.id,
        organizationSlug: ctx.organization.slug,
        itemName: alert.itemName,
        itemSku: alert.itemSku,
        warehouseId: count.warehouseId,
        warehouseName: count.warehouse.name,
        previousQty: alert.previousQty,
        newQty: alert.newQty,
        threshold: alert.threshold,
      });
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.cycle_count.completed',
      entityType: 'CycleCount',
      entityId: cycleCountId,
      metadata: { itemCount: count.items.length },
    });

    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof Error && err.message.includes('recount before completing')) {
      return { success: false, error: err.message };
    }
    return toActionError(err, 'Failed to complete cycle count');
  }
}
