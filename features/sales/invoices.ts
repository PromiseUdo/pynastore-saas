'use server';

import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { sendInvoiceEmail } from '@/lib/email';
import { formatDate, formatMoney } from '@/lib/format';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { InvoiceStatus, PaymentMethod, PurchaseOrderStatus } from '@/lib/generated/prisma/enums';
import { generatePoNumber } from '@/features/procurement/shared';
import { type ActionResult, toActionError, generateDocumentNumber } from './shared';

const LineItemInputSchema = z.object({
  inventoryItemId: z.string().cuid().optional(),
  description: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  isDropShip: z.boolean().optional(),
});

const CreateInvoiceSchema = z.object({
  customerId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  /** Omitted by the UI — a document is written in the org's currency (AGENTS §4). */
  currency: z.string().min(1).max(10).optional(),
  notes: z.string().max(1000).optional(),
  dueDate: z.coerce.date().optional(),
  taxAmount: z.number().nonnegative().optional(),
  lineItems: z.array(LineItemInputSchema).min(1, 'An invoice needs at least one line item'),
});

export type InvoiceListRow = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  customerName: string;
  warehouseName: string | null;
  totalAmount: number;
  paidAmount: number;
  currency: string;
  createdAt: Date;
  dueDate: Date | null;
  isOverdue: boolean;
};

export type InvoiceLineItemRow = {
  id: string;
  inventoryItemId: string | null;
  itemName: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  returnedQty: number;
  isDropShip: boolean;
  dropShipPurchaseOrder: { id: string; poNumber: string; status: PurchaseOrderStatus } | null;
};

export type PaymentRow = {
  id: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  createdAt: Date;
};

export type InvoiceDetail = InvoiceListRow & {
  customerId: string;
  /** null when the customer has no email — nothing can be sent to them */
  customerEmail: string | null;
  /** when it was first emailed, and last chased */
  sentAt: Date | null;
  lastReminderAt: Date | null;
  /** the customer's own link, once it has been sent at least once */
  publicUrl: string | null;
  warehouseId: string | null;
  subtotal: number;
  taxAmount: number;
  notes: string | null;
  lineItems: InvoiceLineItemRow[];
  payments: PaymentRow[];
  fulfillmentId: string | null;
};

function isOverdue(status: InvoiceStatus, dueDate: Date | null): boolean {
  return (
    (status === InvoiceStatus.SENT || status === InvoiceStatus.PARTIALLY_PAID) &&
    dueDate !== null &&
    dueDate.getTime() < Date.now()
  );
}

function computeTotals(lineItems: z.infer<typeof LineItemInputSchema>[], taxAmount: number) {
  const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  return { subtotal, totalAmount: subtotal + taxAmount };
}

export async function createInvoice(
  input: z.infer<typeof CreateInvoiceSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_CREATE);

    const data = CreateInvoiceSchema.parse(input);

    const [customer, warehouse] = await Promise.all([
      prisma.customer.findUnique({ where: { id: data.customerId }, select: { organizationId: true } }),
      prisma.warehouse.findUnique({ where: { id: data.warehouseId }, select: { organizationId: true } }),
    ]);
    if (!customer || customer.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Customer not found' };
    }
    if (!warehouse || warehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }

    const itemIds = data.lineItems.map((li) => li.inventoryItemId).filter((id): id is string => !!id);
    const items =
      itemIds.length > 0
        ? await prisma.inventoryItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, organizationId: true, preferredSupplierId: true },
          })
        : [];
    if (itemIds.length > 0 && (items.length !== new Set(itemIds).size || items.some((i) => i.organizationId !== ctx.organization.id))) {
      return { success: false, error: 'One or more items were not found' };
    }

    const itemMap = new Map(items.map((i) => [i.id, i]));
    for (const li of data.lineItems) {
      if (!li.isDropShip) continue;
      if (!li.inventoryItemId) {
        return { success: false, error: 'Drop-ship lines must be linked to a catalog item' };
      }
      const item = itemMap.get(li.inventoryItemId);
      if (!item?.preferredSupplierId) {
        return { success: false, error: `Set a preferred supplier on "${li.description}" before drop-shipping it` };
      }
    }

    const taxAmount = data.taxAmount ?? 0;
    const { subtotal, totalAmount } = computeTotals(data.lineItems, taxAmount);

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await generateDocumentNumber(ctx.organization.id, 'INV', 'invoice');
      return tx.invoice.create({
        data: {
          organizationId: ctx.organization.id,
          customerId: data.customerId,
          warehouseId: data.warehouseId,
          invoiceNumber,
          currency: data.currency ?? ctx.organization.currency,
          subtotal,
          taxAmount,
          totalAmount,
          notes: data.notes,
          dueDate: data.dueDate,
          lineItems: {
            create: data.lineItems.map((li) => ({
              inventoryItemId: li.inventoryItemId,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              totalPrice: li.quantity * li.unitPrice,
              isDropShip: li.isDropShip ?? false,
            })),
          },
        },
      });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.invoice.created',
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, totalAmount },
    });

    return { success: true, data: { id: invoice.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create invoice');
  }
}

export async function listInvoices(filters?: { status?: InvoiceStatus }): Promise<ActionResult<InvoiceListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const invoices = await prisma.invoice.findMany({
      where: { organizationId: ctx.organization.id, status: filters?.status },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        currency: true,
        createdAt: true,
        dueDate: true,
        customer: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        customerName: inv.customer.name,
        warehouseName: inv.warehouse?.name ?? null,
        totalAmount: Number(inv.totalAmount),
        paidAmount: Number(inv.paidAmount),
        currency: inv.currency,
        createdAt: inv.createdAt,
        dueDate: inv.dueDate,
        isOverdue: isOverdue(inv.status, inv.dueDate),
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load invoices');
  }
}

export async function getInvoice(invoiceId: string): Promise<ActionResult<InvoiceDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: { select: { name: true, email: true } },
        warehouse: { select: { name: true } },
        lineItems: {
          include: {
            inventoryItem: { select: { name: true } },
            dropShipPurchaseOrder: { select: { id: true, poNumber: true, status: true } },
          },
        },
        payments: { orderBy: { createdAt: 'desc' } },
        fulfillment: { select: { id: true } },
      },
    });

    if (!invoice || invoice.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Invoice not found' };
    }

    return {
      success: true,
      data: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        customerId: invoice.customerId,
        customerName: invoice.customer.name,
        warehouseId: invoice.warehouseId,
        warehouseName: invoice.warehouse?.name ?? null,
        subtotal: Number(invoice.subtotal),
        taxAmount: Number(invoice.taxAmount),
        totalAmount: Number(invoice.totalAmount),
        paidAmount: Number(invoice.paidAmount),
        currency: invoice.currency,
        notes: invoice.notes,
        createdAt: invoice.createdAt,
        dueDate: invoice.dueDate,
        isOverdue: isOverdue(invoice.status, invoice.dueDate),
        customerEmail: invoice.customer.email,
        sentAt: invoice.sentAt,
        lastReminderAt: invoice.lastReminderAt,
        publicUrl: invoice.publicToken
          ? getStorefrontUrl(ctx.organization.slug, `/invoice/${invoice.publicToken}`)
          : null,
        lineItems: invoice.lineItems.map((li) => ({
          id: li.id,
          inventoryItemId: li.inventoryItemId,
          itemName: li.inventoryItem?.name ?? null,
          description: li.description,
          quantity: Number(li.quantity),
          unitPrice: Number(li.unitPrice),
          totalPrice: Number(li.totalPrice),
          returnedQty: Number(li.returnedQty),
          isDropShip: li.isDropShip,
          dropShipPurchaseOrder: li.dropShipPurchaseOrder,
        })),
        payments: invoice.payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          method: p.method,
          reference: p.reference,
          notes: p.notes,
          createdAt: p.createdAt,
        })),
        fulfillmentId: invoice.fulfillment?.id ?? null,
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load invoice');
  }
}

export async function issueInvoice(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_EDIT);

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, warehouse: { select: { name: true } } },
    });
    if (!invoice || invoice.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Invoice not found' };
    }
    if (invoice.status !== InvoiceStatus.DRAFT) {
      return { success: false, error: 'Only draft invoices can be issued' };
    }
    if (!invoice.warehouseId) {
      return { success: false, error: 'This invoice has no fulfillment store set' };
    }
    const warehouseId = invoice.warehouseId;

    const stockLines = invoice.lineItems.filter((li) => li.inventoryItemId);
    const dropShipLines = stockLines.filter((li) => li.isDropShip);
    const normalLines = stockLines.filter((li) => !li.isDropShip);

    const levels = normalLines.length
      ? await prisma.inventoryLevel.findMany({
          where: {
            warehouseId,
            inventoryItemId: { in: normalLines.map((li) => li.inventoryItemId!) },
          },
        })
      : [];
    const levelMap = new Map(levels.map((l) => [l.inventoryItemId, l]));

    // Available-to-promise, not raw on-hand — stock already reserved by
    // another issued invoice can't be double-committed.
    for (const li of normalLines) {
      const level = levelMap.get(li.inventoryItemId!);
      const available = level ? Number(level.quantity) - Number(level.reservedQty) : 0;
      if (available < Number(li.quantity)) {
        return { success: false, error: `Insufficient available stock for "${li.description}" at ${invoice.warehouse!.name}` };
      }
    }

    // Re-validate at issue time — the preferred supplier may have changed
    // (or been cleared) since the line was created.
    const dropShipItems = dropShipLines.length
      ? await prisma.inventoryItem.findMany({
          where: { id: { in: dropShipLines.map((li) => li.inventoryItemId!) } },
          select: { id: true, preferredSupplierId: true },
        })
      : [];
    const dropShipItemMap = new Map(dropShipItems.map((i) => [i.id, i]));
    for (const li of dropShipLines) {
      if (!dropShipItemMap.get(li.inventoryItemId!)?.preferredSupplierId) {
        return { success: false, error: `"${li.description}" no longer has a preferred supplier set for drop-shipping` };
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const li of dropShipLines) {
        const supplierId = dropShipItemMap.get(li.inventoryItemId!)!.preferredSupplierId!;
        const poNumber = await generatePoNumber(ctx.organization.id);
        const po = await tx.purchaseOrder.create({
          data: {
            organizationId: ctx.organization.id,
            supplierId,
            customerId: invoice.customerId,
            poNumber,
            subtotal: li.totalPrice,
            totalAmount: li.totalPrice,
            notes: `Drop-ship for invoice ${invoice.invoiceNumber}`,
            lineItems: {
              create: {
                inventoryItemId: li.inventoryItemId,
                description: li.description,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                totalPrice: li.totalPrice,
              },
            },
          },
        });

        await tx.invoiceLineItem.update({
          where: { id: li.id },
          data: { dropShipPurchaseOrderId: po.id },
        });
      }

      for (const li of normalLines) {
        const qty = Number(li.quantity);

        // Soft-reserve: RESERVED is a ledger note only — the actual
        // reservation state lives on InventoryLevel.reservedQty. Stock only
        // really leaves once features/sales/fulfillment.ts:recordPacked runs.
        await tx.stockMovement.create({
          data: {
            organizationId: ctx.organization.id,
            inventoryItemId: li.inventoryItemId!,
            warehouseId,
            type: 'RESERVED',
            quantity: qty,
            referenceType: 'Invoice',
            referenceId: invoiceId,
            performedById: ctx.userId,
          },
        });

        await tx.inventoryLevel.update({
          where: { inventoryItemId_warehouseId: { inventoryItemId: li.inventoryItemId!, warehouseId } },
          data: { reservedQty: { increment: qty } },
        });

        const item = await tx.inventoryItem.findUnique({
          where: { id: li.inventoryItemId! },
          select: { averageCost: true },
        });
        if (item) {
          await tx.invoiceLineItem.update({
            where: { id: li.id },
            data: { unitCost: item.averageCost },
          });
        }
      }

      if (normalLines.length > 0) {
        await tx.fulfillment.create({
          data: {
            organizationId: ctx.organization.id,
            invoiceId,
            warehouseId,
            lineItems: {
              create: normalLines.map((li) => ({
                invoiceLineItemId: li.id,
                inventoryItemId: li.inventoryItemId!,
                quantity: li.quantity,
              })),
            },
          },
        });
      }

      await tx.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.SENT } });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.invoice.issued',
      entityType: 'Invoice',
      entityId: invoiceId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to issue invoice');
  }
}

const RecordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.nativeEnum(PaymentMethod),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export async function recordPayment(
  invoiceId: string,
  input: z.infer<typeof RecordPaymentSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_EDIT);

    const data = RecordPaymentSchema.parse(input);

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Invoice not found' };
    }
    if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.VOID) {
      return { success: false, error: 'This invoice cannot accept payments' };
    }

    const newPaidAmount = Number(invoice.paidAmount) + data.amount;
    if (newPaidAmount > Number(invoice.totalAmount) + 1e-9) {
      return { success: false, error: 'Payment exceeds the outstanding balance' };
    }
    const newStatus = newPaidAmount >= Number(invoice.totalAmount) - 1e-9 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          organizationId: ctx.organization.id,
          invoiceId,
          amount: data.amount,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          recordedById: ctx.userId,
        },
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: newStatus === InvoiceStatus.PAID ? new Date() : undefined,
        },
      });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.invoice.payment_recorded',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { amount: data.amount, method: data.method },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to record payment');
  }
}

export async function voidInvoice(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_VOID);

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        fulfillment: { include: { lineItems: true } },
      },
    });
    if (!invoice || invoice.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Invoice not found' };
    }
    if (
      invoice.status !== InvoiceStatus.DRAFT &&
      invoice.status !== InvoiceStatus.SENT &&
      invoice.status !== InvoiceStatus.PARTIALLY_PAID
    ) {
      return { success: false, error: 'This invoice can no longer be voided' };
    }

    const fulfillment = invoice.fulfillment;

    await prisma.$transaction(async (tx) => {
      if (fulfillment) {
        const warehouseId = fulfillment.warehouseId;
        for (const fli of fulfillment.lineItems) {
          const packedQty = Number(fli.packedQty);
          const reservedRemaining = Number(fli.quantity) - packedQty;

          // Portion that was only reserved, never physically decremented —
          // just release the hold, no compensating movement needed (RESERVED
          // was a ledger note, not a real stock change).
          if (reservedRemaining > 0) {
            await tx.inventoryLevel.update({
              where: { inventoryItemId_warehouseId: { inventoryItemId: fli.inventoryItemId, warehouseId } },
              data: { reservedQty: { decrement: reservedRemaining } },
            });
          }

          // Portion that was actually packed (stock really left) — reverse it.
          if (packedQty > 0) {
            await tx.stockMovement.create({
              data: {
                organizationId: ctx.organization.id,
                inventoryItemId: fli.inventoryItemId,
                warehouseId,
                type: 'IN',
                quantity: packedQty,
                referenceType: 'Invoice',
                referenceId: invoiceId,
                notes: 'Invoice voided — packed stock returned',
                performedById: ctx.userId,
              },
            });

            await tx.inventoryLevel.update({
              where: { inventoryItemId_warehouseId: { inventoryItemId: fli.inventoryItemId, warehouseId } },
              data: { quantity: { increment: packedQty } },
            });
          }
        }

        await tx.fulfillment.update({ where: { id: fulfillment.id }, data: { status: 'CANCELLED' } });
      }

      await tx.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.VOID } });
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'sales.invoice.voided',
      entityType: 'Invoice',
      entityId: invoiceId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to void invoice');
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Sending it to the customer
 *
 * An invoice could be issued but never reach anyone: there was no email, no
 * customer-facing page and nothing to link to (docs/ROADMAP.md Phase 3).
 *
 * The link's key is `publicToken`, minted on the first send. The invoice
 * number counts upwards, so it can never be what opens the page — anyone who
 * could count would otherwise read the whole store's invoices by editing a
 * URL. Same reasoning, and the same 256 bits, as Order.confirmationToken.
 * ──────────────────────────────────────────────────────────────────────── */

/** An invoice that can still be chased: sent or part-paid, and not void. */
const CHASEABLE: InvoiceStatus[] = [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];

async function invoiceForSending(invoiceId: string, organizationId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      totalAmount: true,
      paidAmount: true,
      dueDate: true,
      notes: true,
      publicToken: true,
      sentAt: true,
      customer: { select: { name: true, email: true } },
      lineItems: { select: { description: true, quantity: true, totalPrice: true } },
      organization: { select: { slug: true, name: true, logoUrl: true } },
    },
  });
}

type SendableInvoice = NonNullable<Awaited<ReturnType<typeof invoiceForSending>>>;

/**
 * Put the email together and send it. Shared by the first send and every
 * reminder, so the two can't drift apart.
 */
async function deliverInvoice(
  invoice: SendableInvoice,
  kind: 'issued' | 'reminder',
  organizationId: string,
): Promise<string> {
  const token = invoice.publicToken ?? randomBytes(32).toString('base64url');

  const outstanding = Number(invoice.totalAmount) - Number(invoice.paidAmount);
  const overdueDays =
    invoice.dueDate && invoice.dueDate < new Date()
      ? Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000)
      : null;

  /* The same accounts the online checkout offers. A customer who can't see
   * where to send the money has been sent a bill they can't pay. */
  const accounts = await prisma.merchantBankAccount.findMany({
    where: { organizationId, isActive: true },
    select: { bankName: true, accountName: true, accountNumber: true },
  });

  const money = (value: number) => formatMoney(value, invoice.currency);

  await sendInvoiceEmail({
    to: invoice.customer.email!,
    kind,
    businessName: invoice.organization.name,
    businessLogoUrl: invoice.organization.logoUrl,
    customerName: invoice.customer.name,
    invoiceNumber: invoice.invoiceNumber,
    invoiceUrl: getStorefrontUrl(invoice.organization.slug, `/invoice/${token}`),
    total: money(Number(invoice.totalAmount)),
    outstanding: money(outstanding),
    dueDate: invoice.dueDate ? formatDate(invoice.dueDate) : null,
    daysOverdue: overdueDays,
    lines: invoice.lineItems.map((line) => ({
      name: line.description,
      quantity: Number(line.quantity),
      total: money(Number(line.totalPrice)),
    })),
    bankAccounts: accounts,
    notes: invoice.notes,
  });

  return token;
}

/**
 * Email the invoice to its customer, minting the link if this is the first
 * time. A draft is issued first — sending one is what "issue" means, and
 * splitting them would let a merchant email a bill whose stock was never
 * committed.
 */
export async function sendInvoice(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_EDIT);
    const organizationId = ctx.organization.id;

    let invoice = await invoiceForSending(invoiceId, organizationId);
    if (!invoice) return { success: false, error: 'Invoice not found' };

    if (invoice.status === InvoiceStatus.VOID) {
      return { success: false, error: 'This invoice has been voided' };
    }
    if (!invoice.customer.email) {
      return {
        success: false,
        error: `${invoice.customer.name} has no email address. Add one on the customer before sending.`,
      };
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      const issued = await issueInvoice(invoiceId);
      if (!issued.success) return issued;
      invoice = (await invoiceForSending(invoiceId, organizationId))!;
    }

    const token = await deliverInvoice(invoice, 'issued', organizationId);

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { publicToken: token, sentAt: new Date() },
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'sales.invoice.sent',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber: invoice.invoiceNumber, to: invoice.customer.email, resent: Boolean(invoice.sentAt) },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'We couldn’t send that invoice');
  }
}

/**
 * Chase an unpaid one. Deliberately a button rather than a schedule: an
 * automatic dunning sequence is the merchant's relationship with their
 * customer, not ours to run on their behalf.
 */
export async function sendInvoiceReminder(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_EDIT);
    const organizationId = ctx.organization.id;

    const invoice = await invoiceForSending(invoiceId, organizationId);
    if (!invoice) return { success: false, error: 'Invoice not found' };

    if (!CHASEABLE.includes(invoice.status)) {
      return {
        success: false,
        error:
          invoice.status === InvoiceStatus.PAID
            ? 'This invoice is already paid'
            : 'Only an invoice that has been sent can be chased',
      };
    }
    if (!invoice.customer.email) {
      return { success: false, error: `${invoice.customer.name} has no email address` };
    }

    const token = await deliverInvoice(invoice, 'reminder', organizationId);

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { publicToken: token, lastReminderAt: new Date() },
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'sales.invoice.reminded',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber: invoice.invoiceNumber, to: invoice.customer.email },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'We couldn’t send that reminder');
  }
}
