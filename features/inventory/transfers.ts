'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { StockTransferStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError, getAvailableStock } from './shared';

export type TransferRow = {
  id: string;
  itemName: string;
  sku: string;
  fromWarehouseName: string;
  toWarehouseName: string;
  quantity: number;
  status: StockTransferStatus;
  dispatchedAt: Date;
  receivedAt: Date | null;
};

const DispatchTransferSchema = z.object({
  inventoryItemId: z.string().cuid(),
  fromWarehouseId: z.string().cuid(),
  toWarehouseId: z.string().cuid(),
  quantity: z.number().positive(),
  notes: z.string().max(500).optional(),
});

export async function dispatchTransfer(
  input: z.infer<typeof DispatchTransferSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_MOVEMENT_CREATE);

    const data = DispatchTransferSchema.parse(input);
    if (data.fromWarehouseId === data.toWarehouseId) {
      return { success: false, error: 'Source and destination stores must be different' };
    }

    const [item, fromWarehouse, toWarehouse] = await Promise.all([
      prisma.inventoryItem.findUnique({ where: { id: data.inventoryItemId }, select: { organizationId: true } }),
      prisma.warehouse.findUnique({ where: { id: data.fromWarehouseId }, select: { organizationId: true } }),
      prisma.warehouse.findUnique({ where: { id: data.toWarehouseId }, select: { organizationId: true } }),
    ]);
    if (!item || item.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Item not found' };
    }
    if (!fromWarehouse || fromWarehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Source store not found' };
    }
    if (!toWarehouse || toWarehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Destination store not found' };
    }

    const { available } = await getAvailableStock(prisma, {
      inventoryItemId: data.inventoryItemId,
      warehouseId: data.fromWarehouseId,
    });
    if (available < data.quantity) {
      return { success: false, error: `Insufficient available stock at the source store (${available} available, some may be reserved)` };
    }

    const transfer = await prisma.$transaction(async (tx) => {
      const created = await tx.stockTransfer.create({
        data: {
          organizationId: ctx.organization.id,
          inventoryItemId: data.inventoryItemId,
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          quantity: data.quantity,
          notes: data.notes,
          dispatchedById: ctx.userId,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: ctx.organization.id,
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.fromWarehouseId,
          type: 'OUT',
          quantity: data.quantity,
          referenceType: 'StockTransfer',
          referenceId: created.id,
          notes: data.notes,
          performedById: ctx.userId,
        },
      });

      await tx.inventoryLevel.update({
        where: {
          inventoryItemId_warehouseId: { inventoryItemId: data.inventoryItemId, warehouseId: data.fromWarehouseId },
        },
        data: { quantity: { decrement: data.quantity } },
      });

      return created;
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.transfer.dispatched',
      entityType: 'StockTransfer',
      entityId: transfer.id,
      metadata: { fromWarehouseId: data.fromWarehouseId, toWarehouseId: data.toWarehouseId, quantity: data.quantity },
    });

    return { success: true, data: { id: transfer.id } };
  } catch (err) {
    return toActionError(err, 'Failed to dispatch transfer');
  }
}

export async function receiveTransfer(transferId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_MOVEMENT_CREATE);

    const transfer = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Transfer not found' };
    }
    if (transfer.status !== StockTransferStatus.DISPATCHED) {
      return { success: false, error: 'This transfer is not awaiting receipt' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          organizationId: ctx.organization.id,
          inventoryItemId: transfer.inventoryItemId,
          warehouseId: transfer.toWarehouseId,
          type: 'IN',
          quantity: transfer.quantity,
          referenceType: 'StockTransfer',
          referenceId: transfer.id,
          performedById: ctx.userId,
        },
      });

      await tx.inventoryLevel.upsert({
        where: {
          inventoryItemId_warehouseId: { inventoryItemId: transfer.inventoryItemId, warehouseId: transfer.toWarehouseId },
        },
        create: {
          inventoryItemId: transfer.inventoryItemId,
          warehouseId: transfer.toWarehouseId,
          quantity: transfer.quantity,
        },
        update: { quantity: { increment: transfer.quantity } },
      });

      await tx.stockTransfer.update({
        where: { id: transferId },
        data: { status: StockTransferStatus.RECEIVED, receivedById: ctx.userId, receivedAt: new Date() },
      });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.transfer.received',
      entityType: 'StockTransfer',
      entityId: transferId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to receive transfer');
  }
}

export async function cancelTransfer(transferId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_MOVEMENT_CREATE);

    const transfer = await prisma.stockTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Transfer not found' };
    }
    if (transfer.status !== StockTransferStatus.DISPATCHED) {
      return { success: false, error: 'Only dispatched transfers can be cancelled' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          organizationId: ctx.organization.id,
          inventoryItemId: transfer.inventoryItemId,
          warehouseId: transfer.fromWarehouseId,
          type: 'IN',
          quantity: transfer.quantity,
          referenceType: 'StockTransfer',
          referenceId: transfer.id,
          notes: 'Transfer cancelled — stock returned to source store',
          performedById: ctx.userId,
        },
      });

      await tx.inventoryLevel.update({
        where: {
          inventoryItemId_warehouseId: { inventoryItemId: transfer.inventoryItemId, warehouseId: transfer.fromWarehouseId },
        },
        data: { quantity: { increment: transfer.quantity } },
      });

      await tx.stockTransfer.update({
        where: { id: transferId },
        data: { status: StockTransferStatus.CANCELLED },
      });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.transfer.cancelled',
      entityType: 'StockTransfer',
      entityId: transferId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to cancel transfer');
  }
}

export async function listTransfers(filters?: { warehouseId?: string }): Promise<ActionResult<TransferRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const transfers = await prisma.stockTransfer.findMany({
      where: {
        organizationId: ctx.organization.id,
        ...(filters?.warehouseId
          ? { OR: [{ fromWarehouseId: filters.warehouseId }, { toWarehouseId: filters.warehouseId }] }
          : {}),
      },
      select: {
        id: true,
        quantity: true,
        status: true,
        dispatchedAt: true,
        receivedAt: true,
        inventoryItem: { select: { name: true, sku: true } },
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
      },
      orderBy: { dispatchedAt: 'desc' },
    });

    return {
      success: true,
      data: transfers.map((t) => ({
        id: t.id,
        itemName: t.inventoryItem.name,
        sku: t.inventoryItem.sku,
        fromWarehouseName: t.fromWarehouse.name,
        toWarehouseName: t.toWarehouse.name,
        quantity: Number(t.quantity),
        status: t.status,
        dispatchedAt: t.dispatchedAt,
        receivedAt: t.receivedAt,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load transfers');
  }
}
