'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { computeMovingAverageCost } from '@/features/inventory/shared';
import { PurchaseOrderStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError, generatePoNumber } from './shared';

const LineItemInputSchema = z.object({
  inventoryItemId: z.string().cuid().optional(),
  description: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
});

const CreatePOSchema = z.object({
  supplierId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  /** Omitted by the UI — a PO is written in the org's currency (AGENTS §4). */
  currency: z.string().min(1).max(10).optional(),
  notes: z.string().max(1000).optional(),
  expectedAt: z.coerce.date().optional(),
  taxAmount: z.number().nonnegative().optional(),
  lineItems: z.array(LineItemInputSchema).min(1, 'A purchase order needs at least one line item'),
});

export type POListRow = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierName: string;
  warehouseName: string | null;
  totalAmount: number;
  currency: string;
  createdAt: Date;
  expectedAt: Date | null;
};

export type POLineItemRow = {
  id: string;
  inventoryItemId: string | null;
  itemName: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  receivedQty: number;
};

export type PODetail = POListRow & {
  supplierId: string;
  warehouseId: string | null;
  customerId: string | null;
  customerName: string | null;
  subtotal: number;
  taxAmount: number;
  notes: string | null;
  rejectionReason: string | null;
  lineItems: POLineItemRow[];
};

function computeTotals(lineItems: z.infer<typeof LineItemInputSchema>[], taxAmount: number) {
  const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  return { subtotal, totalAmount: subtotal + taxAmount };
}

export async function createPurchaseOrder(
  input: z.infer<typeof CreatePOSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_CREATE);

    const data = CreatePOSchema.parse(input);

    const [supplier, warehouse] = await Promise.all([
      prisma.supplier.findUnique({ where: { id: data.supplierId }, select: { organizationId: true } }),
      prisma.warehouse.findUnique({ where: { id: data.warehouseId }, select: { organizationId: true } }),
    ]);
    if (!supplier || supplier.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Supplier not found' };
    }
    if (!warehouse || warehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }

    const itemIds = data.lineItems.map((li) => li.inventoryItemId).filter((id): id is string => !!id);
    if (itemIds.length > 0) {
      const items = await prisma.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, organizationId: true },
      });
      if (items.length !== new Set(itemIds).size || items.some((i) => i.organizationId !== ctx.organization.id)) {
        return { success: false, error: 'One or more items were not found' };
      }
    }

    const taxAmount = data.taxAmount ?? 0;
    const { subtotal, totalAmount } = computeTotals(data.lineItems, taxAmount);

    const po = await prisma.$transaction(async (tx) => {
      const poNumber = await generatePoNumber(ctx.organization.id);
      const created = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.organization.id,
          supplierId: data.supplierId,
          warehouseId: data.warehouseId,
          poNumber,
          currency: data.currency ?? ctx.organization.currency,
          subtotal,
          taxAmount,
          totalAmount,
          notes: data.notes,
          expectedAt: data.expectedAt,
          lineItems: {
            create: data.lineItems.map((li) => ({
              inventoryItemId: li.inventoryItemId,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              totalPrice: li.quantity * li.unitPrice,
            })),
          },
        },
      });
      return created;
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.created',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      metadata: { poNumber: po.poNumber, totalAmount },
    });

    return { success: true, data: { id: po.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create purchase order');
  }
}

export async function listPurchaseOrders(filters?: {
  status?: PurchaseOrderStatus;
}): Promise<ActionResult<POListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW);

    const pos = await prisma.purchaseOrder.findMany({
      where: { organizationId: ctx.organization.id, status: filters?.status },
      select: {
        id: true,
        poNumber: true,
        status: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        expectedAt: true,
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: pos.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        supplierName: po.supplier.name,
        warehouseName: po.warehouse?.name ?? null,
        totalAmount: Number(po.totalAmount),
        currency: po.currency,
        createdAt: po.createdAt,
        expectedAt: po.expectedAt,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load purchase orders');
  }
}

export async function getPurchaseOrder(poId: string): Promise<ActionResult<PODetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
        customer: { select: { name: true } },
        lineItems: { include: { inventoryItem: { select: { name: true } } } },
      },
    });

    if (!po || po.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Purchase order not found' };
    }

    return {
      success: true,
      data: {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        supplierId: po.supplierId,
        supplierName: po.supplier.name,
        warehouseId: po.warehouseId,
        warehouseName: po.warehouse?.name ?? null,
        customerId: po.customerId,
        customerName: po.customer?.name ?? null,
        subtotal: Number(po.subtotal),
        taxAmount: Number(po.taxAmount),
        totalAmount: Number(po.totalAmount),
        currency: po.currency,
        notes: po.notes,
        rejectionReason: po.rejectionReason,
        createdAt: po.createdAt,
        expectedAt: po.expectedAt,
        lineItems: po.lineItems.map((li) => ({
          id: li.id,
          inventoryItemId: li.inventoryItemId,
          itemName: li.inventoryItem?.name ?? null,
          description: li.description,
          quantity: Number(li.quantity),
          unitPrice: Number(li.unitPrice),
          totalPrice: Number(li.totalPrice),
          receivedQty: Number(li.receivedQty),
        })),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load purchase order');
  }
}

async function loadOwnedPO(organizationId: string, poId: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po || po.organizationId !== organizationId) return null;
  return po;
}

export async function submitForApproval(poId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_EDIT);

    const po = await loadOwnedPO(ctx.organization.id, poId);
    if (!po) return { success: false, error: 'Purchase order not found' };
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      return { success: false, error: 'Only draft purchase orders can be submitted for approval' };
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: PurchaseOrderStatus.PENDING_APPROVAL },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.submitted',
      entityType: 'PurchaseOrder',
      entityId: poId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to submit purchase order');
  }
}

export async function approvePurchaseOrder(poId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_APPROVE);

    const po = await loadOwnedPO(ctx.organization.id, poId);
    if (!po) return { success: false, error: 'Purchase order not found' };
    if (po.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
      return { success: false, error: 'Only purchase orders pending approval can be approved' };
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: PurchaseOrderStatus.APPROVED, approvedById: ctx.userId, approvedAt: new Date() },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.approved',
      entityType: 'PurchaseOrder',
      entityId: poId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to approve purchase order');
  }
}

export async function rejectPurchaseOrder(poId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_REJECT);

    const po = await loadOwnedPO(ctx.organization.id, poId);
    if (!po) return { success: false, error: 'Purchase order not found' };
    if (po.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
      return { success: false, error: 'Only purchase orders pending approval can be rejected' };
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: PurchaseOrderStatus.REJECTED,
        rejectedById: ctx.userId,
        rejectedAt: new Date(),
        rejectionReason: reason.trim() || undefined,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.rejected',
      entityType: 'PurchaseOrder',
      entityId: poId,
      metadata: { reason },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to reject purchase order');
  }
}

export async function markOrdered(poId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_EDIT);

    const po = await loadOwnedPO(ctx.organization.id, poId);
    if (!po) return { success: false, error: 'Purchase order not found' };
    if (po.status !== PurchaseOrderStatus.APPROVED) {
      return { success: false, error: 'Only approved purchase orders can be marked as ordered' };
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: PurchaseOrderStatus.ORDERED },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.ordered',
      entityType: 'PurchaseOrder',
      entityId: poId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to mark purchase order as ordered');
  }
}

/**
 * Terminal step for a drop-ship PO (customerId set, warehouseId null): the
 * supplier confirmed they shipped directly to the customer. Reuses RECEIVED
 * to mean "fulfilled" rather than adding a new status — deliberately does
 * NOT touch StockMovement/InventoryLevel, since we never held this stock.
 */
export async function markDropShipDelivered(poId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_EDIT);

    const po = await loadOwnedPO(ctx.organization.id, poId);
    if (!po) return { success: false, error: 'Purchase order not found' };
    if (!po.customerId) {
      return { success: false, error: 'This purchase order is not a drop-ship order' };
    }
    if (po.status !== PurchaseOrderStatus.ORDERED) {
      return { success: false, error: 'Only ordered purchase orders can be marked delivered' };
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: PurchaseOrderStatus.RECEIVED, receivedAt: new Date() },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.dropship_delivered',
      entityType: 'PurchaseOrder',
      entityId: poId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to mark purchase order as delivered');
  }
}

export async function cancelPurchaseOrder(poId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_EDIT);

    const po = await loadOwnedPO(ctx.organization.id, poId);
    if (!po) return { success: false, error: 'Purchase order not found' };
    if (
      po.status !== PurchaseOrderStatus.DRAFT &&
      po.status !== PurchaseOrderStatus.PENDING_APPROVAL &&
      po.status !== PurchaseOrderStatus.APPROVED
    ) {
      return { success: false, error: 'This purchase order can no longer be cancelled' };
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: PurchaseOrderStatus.CANCELLED },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.cancelled',
      entityType: 'PurchaseOrder',
      entityId: poId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to cancel purchase order');
  }
}

const ReceiveSchema = z.object({
  receipts: z.array(z.object({ lineItemId: z.string().cuid(), receivedQty: z.number().positive() })).min(1),
});

export async function receivePOLineItems(
  poId: string,
  input: z.infer<typeof ReceiveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_RECEIVE);

    const data = ReceiveSchema.parse(input);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lineItems: true },
    });
    if (!po || po.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Purchase order not found' };
    }
    if (!po.warehouseId) {
      return { success: false, error: 'This purchase order has no destination store' };
    }
    if (po.status !== PurchaseOrderStatus.ORDERED && po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      return { success: false, error: 'This purchase order is not ready to receive' };
    }

    const lineItemMap = new Map(po.lineItems.map((li) => [li.id, li]));
    for (const r of data.receipts) {
      const li = lineItemMap.get(r.lineItemId);
      if (!li) return { success: false, error: 'One or more line items were not found on this order' };
      if (Number(li.receivedQty) + r.receivedQty > Number(li.quantity) + 1e-9) {
        return { success: false, error: `Cannot receive more than ordered for "${li.description}"` };
      }
    }

    const warehouseId = po.warehouseId;

    await prisma.$transaction(async (tx) => {
      for (const r of data.receipts) {
        const li = lineItemMap.get(r.lineItemId)!;

        await tx.pOLineItem.update({
          where: { id: li.id },
          data: { receivedQty: { increment: r.receivedQty } },
        });

        if (!li.inventoryItemId) continue;

        await tx.stockMovement.create({
          data: {
            organizationId: ctx.organization.id,
            inventoryItemId: li.inventoryItemId,
            warehouseId,
            type: 'IN',
            quantity: r.receivedQty,
            unitCost: li.unitPrice,
            referenceType: 'PurchaseOrder',
            referenceId: poId,
            performedById: ctx.userId,
          },
        });

        await tx.inventoryLevel.upsert({
          where: { inventoryItemId_warehouseId: { inventoryItemId: li.inventoryItemId, warehouseId } },
          create: { inventoryItemId: li.inventoryItemId, warehouseId, quantity: r.receivedQty },
          update: { quantity: { increment: r.receivedQty } },
        });

        const item = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: li.inventoryItemId },
          select: { averageCost: true },
        });
        const totalsBefore = await tx.inventoryLevel.aggregate({
          where: { inventoryItemId: li.inventoryItemId },
          _sum: { quantity: true },
        });
        const totalQtyBefore = Number(totalsBefore._sum.quantity ?? 0) - r.receivedQty;
        const newAvgCost = computeMovingAverageCost(
          Number(item.averageCost),
          totalQtyBefore,
          r.receivedQty,
          Number(li.unitPrice),
        );
        await tx.inventoryItem.update({
          where: { id: li.inventoryItemId },
          data: { averageCost: newAvgCost },
        });
      }

      const updatedLines = await tx.pOLineItem.findMany({ where: { purchaseOrderId: poId } });
      const fullyReceived = updatedLines.every((li) => Number(li.receivedQty) >= Number(li.quantity) - 1e-9);

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: fullyReceived ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED,
          receivedAt: fullyReceived ? new Date() : undefined,
        },
      });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'procurement.po.received',
      entityType: 'PurchaseOrder',
      entityId: poId,
      metadata: { receipts: data.receipts },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to receive stock for this purchase order');
  }
}
