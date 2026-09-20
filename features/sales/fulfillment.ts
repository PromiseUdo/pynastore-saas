'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { maybeSendLowStockAlert } from '@/features/inventory/shared';
import { FulfillmentStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError } from './shared';

export type FulfillmentListRow = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  warehouseName: string;
  status: FulfillmentStatus;
  itemCount: number;
  createdAt: Date;
};

export type FulfillmentLineItemRow = {
  id: string;
  invoiceLineItemId: string;
  itemName: string;
  quantity: number;
  pickedQty: number;
  packedQty: number;
  location: string | null;
};

export type FulfillmentDetail = FulfillmentListRow & {
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: Date | null;
  lineItems: FulfillmentLineItemRow[];
};

export async function listFulfillments(filters?: { status?: FulfillmentStatus }): Promise<ActionResult<FulfillmentListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const fulfillments = await prisma.fulfillment.findMany({
      where: { organizationId: ctx.organization.id, status: filters?.status },
      select: {
        id: true,
        status: true,
        createdAt: true,
        warehouse: { select: { name: true } },
        invoice: { select: { id: true, invoiceNumber: true, customer: { select: { name: true } } } },
        _count: { select: { lineItems: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: fulfillments.map((f) => ({
        id: f.id,
        invoiceId: f.invoice.id,
        invoiceNumber: f.invoice.invoiceNumber,
        customerName: f.invoice.customer.name,
        warehouseName: f.warehouse.name,
        status: f.status,
        itemCount: f._count.lineItems,
        createdAt: f.createdAt,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load fulfillments');
  }
}

export async function getFulfillment(fulfillmentId: string): Promise<ActionResult<FulfillmentDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const fulfillment = await prisma.fulfillment.findUnique({
      where: { id: fulfillmentId },
      include: {
        warehouse: { select: { name: true } },
        invoice: { select: { id: true, invoiceNumber: true, customer: { select: { name: true } } } },
        lineItems: { include: { inventoryItem: { select: { name: true } } } },
      },
    });

    if (!fulfillment || fulfillment.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Fulfillment not found' };
    }

    const levels = await prisma.inventoryLevel.findMany({
      where: {
        warehouseId: fulfillment.warehouseId,
        inventoryItemId: { in: fulfillment.lineItems.map((li) => li.inventoryItemId) },
      },
      select: { inventoryItemId: true, location: true },
    });
    const locationMap = new Map(levels.map((l) => [l.inventoryItemId, l.location]));

    return {
      success: true,
      data: {
        id: fulfillment.id,
        invoiceId: fulfillment.invoice.id,
        invoiceNumber: fulfillment.invoice.invoiceNumber,
        customerName: fulfillment.invoice.customer.name,
        warehouseName: fulfillment.warehouse.name,
        status: fulfillment.status,
        itemCount: fulfillment.lineItems.length,
        createdAt: fulfillment.createdAt,
        carrier: fulfillment.carrier,
        trackingNumber: fulfillment.trackingNumber,
        shippedAt: fulfillment.shippedAt,
        lineItems: fulfillment.lineItems.map((li) => ({
          id: li.id,
          invoiceLineItemId: li.invoiceLineItemId,
          itemName: li.inventoryItem.name,
          quantity: Number(li.quantity),
          pickedQty: Number(li.pickedQty),
          packedQty: Number(li.packedQty),
          location: locationMap.get(li.inventoryItemId) ?? null,
        })),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load fulfillment');
  }
}

const RecordLinesSchema = z.object({
  lines: z.array(z.object({ fulfillmentLineItemId: z.string().cuid(), quantity: z.number().nonnegative() })).min(1),
});

export async function recordPicked(
  fulfillmentId: string,
  input: z.infer<typeof RecordLinesSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_FULFILLMENT_MANAGE);

    const data = RecordLinesSchema.parse(input);

    const fulfillment = await prisma.fulfillment.findUnique({
      where: { id: fulfillmentId },
      include: { lineItems: true },
    });
    if (!fulfillment || fulfillment.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Fulfillment not found' };
    }
    if (fulfillment.status !== FulfillmentStatus.PENDING && fulfillment.status !== FulfillmentStatus.PARTIALLY_PICKED) {
      return { success: false, error: 'This fulfillment is not awaiting picking' };
    }

    const lineMap = new Map(fulfillment.lineItems.map((li) => [li.id, li]));
    for (const l of data.lines) {
      const li = lineMap.get(l.fulfillmentLineItemId);
      if (!li) return { success: false, error: 'One or more line items were not found' };
      if (l.quantity > Number(li.quantity) + 1e-9) {
        return { success: false, error: `Cannot pick more than ${li.quantity} of the ordered quantity` };
      }
    }

    await prisma.$transaction(
      data.lines.map((l) =>
        prisma.fulfillmentLineItem.update({
          where: { id: l.fulfillmentLineItemId },
          data: { pickedQty: l.quantity },
        }),
      ),
    );

    const updatedLines = await prisma.fulfillmentLineItem.findMany({ where: { fulfillmentId } });
    const allPicked = updatedLines.every((li) => Number(li.pickedQty) >= Number(li.quantity) - 1e-9);
    const somePicked = updatedLines.some((li) => Number(li.pickedQty) > 0);

    await prisma.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        status: allPicked ? FulfillmentStatus.PICKED : somePicked ? FulfillmentStatus.PARTIALLY_PICKED : FulfillmentStatus.PENDING,
        pickedById: ctx.userId,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.fulfillment.picked',
      entityType: 'Fulfillment',
      entityId: fulfillmentId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to record picked quantities');
  }
}

export async function recordPacked(
  fulfillmentId: string,
  input: z.infer<typeof RecordLinesSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_FULFILLMENT_MANAGE);

    const data = RecordLinesSchema.parse(input);

    const fulfillment = await prisma.fulfillment.findUnique({
      where: { id: fulfillmentId },
      include: { lineItems: true, warehouse: { select: { name: true } } },
    });
    if (!fulfillment || fulfillment.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Fulfillment not found' };
    }
    if (fulfillment.status !== FulfillmentStatus.PICKED && fulfillment.status !== FulfillmentStatus.PARTIALLY_PACKED) {
      return { success: false, error: 'This fulfillment is not awaiting packing' };
    }

    const lineMap = new Map(fulfillment.lineItems.map((li) => [li.id, li]));
    for (const l of data.lines) {
      const li = lineMap.get(l.fulfillmentLineItemId);
      if (!li) return { success: false, error: 'One or more line items were not found' };
      if (l.quantity > Number(li.pickedQty) + 1e-9) {
        return { success: false, error: 'Cannot pack more than was picked' };
      }
    }

    const alerts: { itemName: string; itemSku: string; previousQty: number; newQty: number; threshold: number | null }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const l of data.lines) {
        const li = lineMap.get(l.fulfillmentLineItemId)!;
        const previousPacked = Number(li.packedQty);
        const incremental = l.quantity - previousPacked;
        if (incremental <= 0) continue;

        await tx.fulfillmentLineItem.update({
          where: { id: li.id },
          data: { packedQty: l.quantity },
        });

        await tx.stockMovement.create({
          data: {
            organizationId: ctx.organization.id,
            inventoryItemId: li.inventoryItemId,
            warehouseId: fulfillment.warehouseId,
            type: 'OUT',
            quantity: incremental,
            referenceType: 'Invoice',
            referenceId: fulfillment.invoiceId,
            performedById: ctx.userId,
          },
        });

        const level = await tx.inventoryLevel.update({
          where: { inventoryItemId_warehouseId: { inventoryItemId: li.inventoryItemId, warehouseId: fulfillment.warehouseId } },
          data: { quantity: { decrement: incremental }, reservedQty: { decrement: incremental } },
        });

        const item = await tx.inventoryItem.findUnique({
          where: { id: li.inventoryItemId },
          select: { name: true, sku: true, reorderPoint: true },
        });
        if (item) {
          const previousQty = Number(level.quantity) + incremental;
          const threshold = level.reorderPoint ? Number(level.reorderPoint) : item.reorderPoint ? Number(item.reorderPoint) : null;
          alerts.push({ itemName: item.name, itemSku: item.sku, previousQty, newQty: Number(level.quantity), threshold });
        }
      }

      const updatedLines = await tx.fulfillmentLineItem.findMany({ where: { fulfillmentId } });
      const allPacked = updatedLines.every((li) => Number(li.packedQty) >= Number(li.quantity) - 1e-9);
      const somePacked = updatedLines.some((li) => Number(li.packedQty) > 0);

      await tx.fulfillment.update({
        where: { id: fulfillmentId },
        data: {
          status: allPacked ? FulfillmentStatus.PACKED : somePacked ? FulfillmentStatus.PARTIALLY_PACKED : fulfillment.status,
          packedById: ctx.userId,
        },
      });
    });

    for (const alert of alerts) {
      await maybeSendLowStockAlert({
        organizationId: ctx.organization.id,
        organizationSlug: ctx.organization.slug,
        itemName: alert.itemName,
        itemSku: alert.itemSku,
        warehouseName: fulfillment.warehouse.name,
        previousQty: alert.previousQty,
        newQty: alert.newQty,
        threshold: alert.threshold,
      });
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.fulfillment.packed',
      entityType: 'Fulfillment',
      entityId: fulfillmentId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to record packed quantities');
  }
}

const MarkShippedSchema = z.object({
  carrier: z.string().max(100).optional(),
  trackingNumber: z.string().max(100).optional(),
});

export async function markShipped(
  fulfillmentId: string,
  input: z.infer<typeof MarkShippedSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_FULFILLMENT_MANAGE);

    const data = MarkShippedSchema.parse(input);

    const fulfillment = await prisma.fulfillment.findUnique({ where: { id: fulfillmentId } });
    if (!fulfillment || fulfillment.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Fulfillment not found' };
    }
    if (fulfillment.status !== FulfillmentStatus.PACKED) {
      return { success: false, error: 'This fulfillment must be fully packed before it can ship' };
    }

    await prisma.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        status: FulfillmentStatus.SHIPPED,
        carrier: data.carrier,
        trackingNumber: data.trackingNumber,
        shippedById: ctx.userId,
        shippedAt: new Date(),
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.fulfillment.shipped',
      entityType: 'Fulfillment',
      entityId: fulfillmentId,
      metadata: { carrier: data.carrier, trackingNumber: data.trackingNumber },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to mark fulfillment as shipped');
  }
}

export async function cancelFulfillment(fulfillmentId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_FULFILLMENT_MANAGE);

    const fulfillment = await prisma.fulfillment.findUnique({
      where: { id: fulfillmentId },
      include: { lineItems: true },
    });
    if (!fulfillment || fulfillment.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Fulfillment not found' };
    }
    if (
      fulfillment.status !== FulfillmentStatus.PENDING &&
      fulfillment.status !== FulfillmentStatus.PARTIALLY_PICKED &&
      fulfillment.status !== FulfillmentStatus.PICKED
    ) {
      return { success: false, error: 'Packing has already started — void the invoice instead' };
    }

    await prisma.$transaction(async (tx) => {
      for (const li of fulfillment.lineItems) {
        await tx.inventoryLevel.update({
          where: { inventoryItemId_warehouseId: { inventoryItemId: li.inventoryItemId, warehouseId: fulfillment.warehouseId } },
          data: { reservedQty: { decrement: Number(li.quantity) } },
        });
      }

      await tx.fulfillment.update({ where: { id: fulfillmentId }, data: { status: FulfillmentStatus.CANCELLED } });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.fulfillment.cancelled',
      entityType: 'Fulfillment',
      entityId: fulfillmentId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to cancel fulfillment');
  }
}
