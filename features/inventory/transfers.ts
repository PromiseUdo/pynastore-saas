'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { StockTransferStatus } from '@/lib/generated/prisma/enums';
import { canUseStore, requireStoreAccess } from '@/lib/store-access';
import { type ActionResult, toActionError, getAvailableStock } from './shared';
import { GatherTransferError, holdReceivedForOrder, sendRequestedTransfer } from '@/lib/storefront/orders/gather';

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
  /** an order brought together at one store (Phase 9.7): which one, to link to */
  orderId: string | null;
  orderReference: string | null;
  /** the member may send it — the source is one of their stores (Phase 8.6) */
  canSend: boolean;
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

    /* Sending stock away is the source store's act, so only the FROM store is
     * gated — a shop may send goods to any of the business's stores, and the
     * receiving end confirms the box arrived (ROADMAP Phase 8.6). */
    requireStoreAccess(ctx.membership, data.fromWarehouseId);

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

    /* Receiving belongs to the DESTINATION store: whoever is standing there
     * with the box. Someone limited to one store can send stock away and not
     * receive it back — the other end does that (ROADMAP Phase 8.6). */
    requireStoreAccess(ctx.membership, transfer.toWarehouseId);

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

      // Brought here for an order (Phase 9.7): hold it for that order at once.
      await holdReceivedForOrder(tx, transfer);
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

/**
 * Send a transfer an order asked for (ROADMAP Phase 9.7). The source store's
 * act, so its access is checked; the order's hold there goes with the units.
 */
export async function sendOrderTransfer(transferId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_MOVEMENT_CREATE);

    const transfer = await prisma.stockTransfer.findFirst({
      where: { id: String(transferId), organizationId: ctx.organization.id },
      select: { fromWarehouseId: true, toWarehouseId: true, quantity: true, fromWarehouse: { select: { name: true } } },
    });
    if (!transfer) return { success: false, error: 'Transfer not found' };
    requireStoreAccess(ctx.membership, transfer.fromWarehouseId, transfer.fromWarehouse.name);

    await prisma.$transaction((tx) =>
      sendRequestedTransfer(tx, { organizationId: ctx.organization.id, transferId: String(transferId), performedById: ctx.userId }),
    );

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.transfer.dispatched',
      entityType: 'StockTransfer',
      entityId: String(transferId),
      metadata: { fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId, quantity: Number(transfer.quantity), forOrder: true },
    });
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof GatherTransferError) return { success: false, error: err.message };
    return toActionError(err, 'Failed to send transfer');
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

    // Cancelling puts the stock back on the sender's shelf, so it is theirs.
    requireStoreAccess(ctx.membership, transfer.fromWarehouseId);

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
        fromWarehouseId: true,
        order: { select: { id: true, reference: true } },
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
        orderId: t.order?.id ?? null,
        orderReference: t.order?.reference ?? null,
        canSend: canUseStore(ctx.membership, t.fromWarehouseId),
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load transfers');
  }
}
