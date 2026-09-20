'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { InvoiceStatus, ReturnStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError } from './shared';

const ELIGIBLE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
  InvoiceStatus.OVERDUE,
];

export type ReturnListRow = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  status: ReturnStatus;
  itemCount: number;
  createdAt: Date;
};

export type ReturnLineItemRow = {
  id: string;
  invoiceLineItemId: string;
  description: string;
  quantity: number;
};

export type ReturnDetail = ReturnListRow & {
  reason: string | null;
  notes: string | null;
  lineItems: ReturnLineItemRow[];
};

const RequestReturnSchema = z.object({
  reason: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  lineItems: z.array(z.object({ invoiceLineItemId: z.string().cuid(), quantity: z.number().positive() })).min(1),
});

export async function requestReturn(
  invoiceId: string,
  input: z.infer<typeof RequestReturnSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_RETURN_MANAGE);

    const data = RequestReturnSchema.parse(input);

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, fulfillment: { select: { status: true } } },
    });
    if (!invoice || invoice.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Invoice not found' };
    }
    if (!ELIGIBLE_INVOICE_STATUSES.includes(invoice.status)) {
      return { success: false, error: 'This invoice is not eligible for a return' };
    }
    if (invoice.fulfillment && invoice.fulfillment.status !== 'SHIPPED') {
      return { success: false, error: 'This order has not been shipped yet' };
    }

    const lineItemMap = new Map(invoice.lineItems.map((li) => [li.id, li]));
    for (const r of data.lineItems) {
      const li = lineItemMap.get(r.invoiceLineItemId);
      if (!li) return { success: false, error: 'One or more line items were not found on this invoice' };
      const remaining = Number(li.quantity) - Number(li.returnedQty);
      if (r.quantity > remaining + 1e-9) {
        return { success: false, error: `Cannot return more than ${remaining} of "${li.description}"` };
      }
    }

    const returnRequest = await prisma.returnRequest.create({
      data: {
        organizationId: ctx.organization.id,
        invoiceId,
        reason: data.reason,
        notes: data.notes,
        requestedById: ctx.userId,
        lineItems: {
          create: data.lineItems.map((r) => ({
            invoiceLineItemId: r.invoiceLineItemId,
            quantity: r.quantity,
          })),
        },
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.return.requested',
      entityType: 'ReturnRequest',
      entityId: returnRequest.id,
      metadata: { invoiceId },
    });

    return { success: true, data: { id: returnRequest.id } };
  } catch (err) {
    return toActionError(err, 'Failed to request return');
  }
}

export async function listReturns(): Promise<ActionResult<ReturnListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const returns = await prisma.returnRequest.findMany({
      where: { organizationId: ctx.organization.id },
      select: {
        id: true,
        status: true,
        createdAt: true,
        invoice: { select: { id: true, invoiceNumber: true, customer: { select: { name: true } } } },
        _count: { select: { lineItems: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: returns.map((r) => ({
        id: r.id,
        invoiceId: r.invoice.id,
        invoiceNumber: r.invoice.invoiceNumber,
        customerName: r.invoice.customer.name,
        status: r.status,
        itemCount: r._count.lineItems,
        createdAt: r.createdAt,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load returns');
  }
}

export async function getReturn(returnId: string): Promise<ActionResult<ReturnDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnId },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, customer: { select: { name: true } } } },
        lineItems: { include: { invoiceLineItem: { select: { description: true } } } },
      },
    });

    if (!returnRequest || returnRequest.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Return not found' };
    }

    return {
      success: true,
      data: {
        id: returnRequest.id,
        invoiceId: returnRequest.invoice.id,
        invoiceNumber: returnRequest.invoice.invoiceNumber,
        customerName: returnRequest.invoice.customer.name,
        status: returnRequest.status,
        reason: returnRequest.reason,
        notes: returnRequest.notes,
        itemCount: returnRequest.lineItems.length,
        createdAt: returnRequest.createdAt,
        lineItems: returnRequest.lineItems.map((li) => ({
          id: li.id,
          invoiceLineItemId: li.invoiceLineItemId,
          description: li.invoiceLineItem.description,
          quantity: Number(li.quantity),
        })),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load return');
  }
}

export async function approveReturn(returnId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_RETURN_MANAGE);

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnId },
      include: {
        invoice: true,
        lineItems: { include: { invoiceLineItem: true } },
      },
    });
    if (!returnRequest || returnRequest.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Return not found' };
    }
    if (returnRequest.status !== ReturnStatus.REQUESTED) {
      return { success: false, error: 'Only requested returns can be approved' };
    }
    if (!returnRequest.invoice.warehouseId) {
      return { success: false, error: 'The original invoice has no fulfillment store to restock into' };
    }
    const warehouseId = returnRequest.invoice.warehouseId;

    await prisma.$transaction(async (tx) => {
      for (const rli of returnRequest.lineItems) {
        const invoiceLineItem = rli.invoiceLineItem;
        if (!invoiceLineItem.inventoryItemId) continue;

        await tx.stockMovement.create({
          data: {
            organizationId: ctx.organization.id,
            inventoryItemId: invoiceLineItem.inventoryItemId,
            warehouseId,
            type: 'IN',
            quantity: rli.quantity,
            referenceType: 'Return',
            referenceId: returnId,
            performedById: ctx.userId,
          },
        });

        await tx.inventoryLevel.upsert({
          where: { inventoryItemId_warehouseId: { inventoryItemId: invoiceLineItem.inventoryItemId, warehouseId } },
          create: { inventoryItemId: invoiceLineItem.inventoryItemId, warehouseId, quantity: rli.quantity },
          update: { quantity: { increment: rli.quantity } },
        });

        await tx.invoiceLineItem.update({
          where: { id: invoiceLineItem.id },
          data: { returnedQty: { increment: rli.quantity } },
        });
      }

      await tx.returnRequest.update({
        where: { id: returnId },
        data: { status: ReturnStatus.APPROVED, approvedById: ctx.userId, approvedAt: new Date() },
      });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.return.approved',
      entityType: 'ReturnRequest',
      entityId: returnId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to approve return');
  }
}

export async function rejectReturn(returnId: string, reason?: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_RETURN_MANAGE);

    const returnRequest = await prisma.returnRequest.findUnique({ where: { id: returnId } });
    if (!returnRequest || returnRequest.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Return not found' };
    }
    if (returnRequest.status !== ReturnStatus.REQUESTED) {
      return { success: false, error: 'Only requested returns can be rejected' };
    }

    await prisma.returnRequest.update({
      where: { id: returnId },
      data: { status: ReturnStatus.REJECTED, notes: reason ?? returnRequest.notes },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.return.rejected',
      entityType: 'ReturnRequest',
      entityId: returnId,
      metadata: { reason },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to reject return');
  }
}
