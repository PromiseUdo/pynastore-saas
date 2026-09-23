'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { QuoteStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError, generateDocumentNumber } from './shared';

const LineItemInputSchema = z.object({
  inventoryItemId: z.string().cuid().optional(),
  description: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
});

const CreateQuoteSchema = z.object({
  customerId: z.string().cuid(),
  /** Omitted by the UI — a document is written in the org's currency (AGENTS §4). */
  currency: z.string().min(1).max(10).optional(),
  notes: z.string().max(1000).optional(),
  validUntil: z.coerce.date().optional(),
  taxAmount: z.number().nonnegative().optional(),
  lineItems: z.array(LineItemInputSchema).min(1, 'A quote needs at least one line item'),
});

export type QuoteListRow = {
  id: string;
  quoteNumber: string;
  status: QuoteStatus;
  customerName: string;
  totalAmount: number;
  currency: string;
  createdAt: Date;
  validUntil: Date | null;
  isExpired: boolean;
  convertedToInvoiceId: string | null;
};

export type QuoteLineItemRow = {
  id: string;
  inventoryItemId: string | null;
  itemName: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type QuoteDetail = QuoteListRow & {
  customerId: string;
  subtotal: number;
  taxAmount: number;
  notes: string | null;
  lineItems: QuoteLineItemRow[];
};

function isExpired(status: QuoteStatus, validUntil: Date | null): boolean {
  return (
    (status === QuoteStatus.SENT || status === QuoteStatus.DRAFT) &&
    validUntil !== null &&
    validUntil.getTime() < Date.now()
  );
}

function computeTotals(lineItems: z.infer<typeof LineItemInputSchema>[], taxAmount: number) {
  const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  return { subtotal, totalAmount: subtotal + taxAmount };
}

export async function createQuote(
  input: z.infer<typeof CreateQuoteSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_QUOTE_CREATE);

    const data = CreateQuoteSchema.parse(input);

    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { organizationId: true },
    });
    if (!customer || customer.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Customer not found' };
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

    const quote = await prisma.$transaction(async (tx) => {
      const quoteNumber = await generateDocumentNumber(ctx.organization.id, 'QT', 'quote');
      return tx.quote.create({
        data: {
          organizationId: ctx.organization.id,
          customerId: data.customerId,
          quoteNumber,
          currency: data.currency ?? ctx.organization.currency,
          subtotal,
          taxAmount,
          totalAmount,
          notes: data.notes,
          validUntil: data.validUntil,
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
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.quote.created',
      entityType: 'Quote',
      entityId: quote.id,
      metadata: { quoteNumber: quote.quoteNumber, totalAmount },
    });

    return { success: true, data: { id: quote.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create quote');
  }
}

export async function listQuotes(filters?: { status?: QuoteStatus }): Promise<ActionResult<QuoteListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const quotes = await prisma.quote.findMany({
      where: { organizationId: ctx.organization.id, status: filters?.status },
      select: {
        id: true,
        quoteNumber: true,
        status: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        validUntil: true,
        convertedToInvoiceId: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: quotes.map((q) => ({
        id: q.id,
        quoteNumber: q.quoteNumber,
        status: q.status,
        customerName: q.customer.name,
        totalAmount: Number(q.totalAmount),
        currency: q.currency,
        createdAt: q.createdAt,
        validUntil: q.validUntil,
        isExpired: isExpired(q.status, q.validUntil),
        convertedToInvoiceId: q.convertedToInvoiceId,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load quotes');
  }
}

export async function getQuote(quoteId: string): Promise<ActionResult<QuoteDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        customer: { select: { name: true } },
        lineItems: { include: { inventoryItem: { select: { name: true } } } },
      },
    });

    if (!quote || quote.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Quote not found' };
    }

    return {
      success: true,
      data: {
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        status: quote.status,
        customerId: quote.customerId,
        customerName: quote.customer.name,
        subtotal: Number(quote.subtotal),
        taxAmount: Number(quote.taxAmount),
        totalAmount: Number(quote.totalAmount),
        currency: quote.currency,
        notes: quote.notes,
        createdAt: quote.createdAt,
        validUntil: quote.validUntil,
        isExpired: isExpired(quote.status, quote.validUntil),
        convertedToInvoiceId: quote.convertedToInvoiceId,
        lineItems: quote.lineItems.map((li) => ({
          id: li.id,
          inventoryItemId: li.inventoryItemId,
          itemName: li.inventoryItem?.name ?? null,
          description: li.description,
          quantity: Number(li.quantity),
          unitPrice: Number(li.unitPrice),
          totalPrice: Number(li.totalPrice),
        })),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load quote');
  }
}

async function loadOwnedQuote(organizationId: string, quoteId: string) {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.organizationId !== organizationId) return null;
  return quote;
}

export async function sendQuote(quoteId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_QUOTE_EDIT);

    const quote = await loadOwnedQuote(ctx.organization.id, quoteId);
    if (!quote) return { success: false, error: 'Quote not found' };
    if (quote.status !== QuoteStatus.DRAFT) {
      return { success: false, error: 'Only draft quotes can be sent' };
    }

    await prisma.quote.update({ where: { id: quoteId }, data: { status: QuoteStatus.SENT } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.quote.sent',
      entityType: 'Quote',
      entityId: quoteId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to send quote');
  }
}

export async function acceptQuote(quoteId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_QUOTE_EDIT);

    const quote = await loadOwnedQuote(ctx.organization.id, quoteId);
    if (!quote) return { success: false, error: 'Quote not found' };
    if (quote.status !== QuoteStatus.SENT) {
      return { success: false, error: 'Only sent quotes can be accepted' };
    }

    await prisma.quote.update({ where: { id: quoteId }, data: { status: QuoteStatus.ACCEPTED } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.quote.accepted',
      entityType: 'Quote',
      entityId: quoteId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to accept quote');
  }
}

export async function rejectQuote(quoteId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_QUOTE_EDIT);

    const quote = await loadOwnedQuote(ctx.organization.id, quoteId);
    if (!quote) return { success: false, error: 'Quote not found' };
    if (quote.status !== QuoteStatus.SENT) {
      return { success: false, error: 'Only sent quotes can be rejected' };
    }

    await prisma.quote.update({ where: { id: quoteId }, data: { status: QuoteStatus.REJECTED } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.quote.rejected',
      entityType: 'Quote',
      entityId: quoteId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to reject quote');
  }
}

export async function convertQuoteToInvoice(
  quoteId: string,
  input: { warehouseId: string; dueDate?: Date },
): Promise<ActionResult<{ invoiceId: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_CREATE);

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { lineItems: true },
    });
    if (!quote || quote.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Quote not found' };
    }
    if (quote.status !== QuoteStatus.ACCEPTED) {
      return { success: false, error: 'Only accepted quotes can be converted to an invoice' };
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { organizationId: true },
    });
    if (!warehouse || warehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await generateDocumentNumber(ctx.organization.id, 'INV', 'invoice');
      const created = await tx.invoice.create({
        data: {
          organizationId: ctx.organization.id,
          customerId: quote.customerId,
          quoteId: quote.id,
          warehouseId: input.warehouseId,
          invoiceNumber,
          currency: quote.currency,
          subtotal: quote.subtotal,
          taxAmount: quote.taxAmount,
          totalAmount: quote.totalAmount,
          notes: quote.notes,
          dueDate: input.dueDate,
          lineItems: {
            create: quote.lineItems.map((li) => ({
              inventoryItemId: li.inventoryItemId,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              totalPrice: li.totalPrice,
            })),
          },
        },
      });

      await tx.quote.update({
        where: { id: quoteId },
        data: { status: QuoteStatus.CONVERTED, convertedToInvoiceId: created.id },
      });

      return created;
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.quote.converted',
      entityType: 'Quote',
      entityId: quoteId,
      metadata: { invoiceId: invoice.id },
    });

    return { success: true, data: { invoiceId: invoice.id } };
  } catch (err) {
    return toActionError(err, 'Failed to convert quote to invoice');
  }
}
