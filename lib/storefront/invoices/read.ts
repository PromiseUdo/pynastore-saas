/*
 * lib/storefront/invoices/read.ts
 *
 * The customer's own copy of an invoice.
 *
 * ONE WAY IN: the token. The invoice number counts upwards, so accepting it
 * here would let anyone read the whole store's invoices by editing a URL —
 * the same reasoning as Order.confirmationToken, and the reason this file
 * has no lookup by number at all.
 *
 * The token is matched TOGETHER with the organization, so a token from one
 * store is a miss under another store's domain rather than a leak.
 *
 * Server only.
 */
import { prisma } from '@/lib/prisma';

export interface PublicInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface PublicInvoice {
  invoiceNumber: string;
  status: string;
  currency: string;
  issuedAt: string | null;
  dueDate: string | null;
  /** past its due date and not settled */
  overdue: boolean;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  paidAt: string | null;
  notes: string | null;
  lines: PublicInvoiceLine[];
  customer: { name: string; email: string | null; phone: string | null; address: string | null };
  business: {
    name: string;
    logoUrl: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
    address: string | null;
  };
  /** where to send the money — only accounts the merchant has published */
  bankAccounts: { bankName: string; accountName: string; accountNumber: string }[];
  /** what the merchant has recorded receiving, oldest first */
  payments: { amount: number; method: string; reference: string | null; receivedAt: string }[];
}

export async function getInvoiceByToken(
  organizationId: string,
  /* Nullable because callers hand this straight from a URL or a database
   * column, and an absent token must read as "no such invoice" rather than
   * throwing on someone's bill. */
  token: string | null | undefined,
): Promise<PublicInvoice | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;

  const invoice = await prisma.invoice.findFirst({
    where: { organizationId, publicToken: trimmed },
    select: {
      invoiceNumber: true,
      status: true,
      currency: true,
      sentAt: true,
      dueDate: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      paidAmount: true,
      paidAt: true,
      notes: true,
      createdAt: true,
      lineItems: {
        select: { description: true, quantity: true, unitPrice: true, totalPrice: true },
      },
      customer: { select: { name: true, email: true, phone: true, address: true } },
      organization: {
        select: { name: true, logoUrl: true, supportEmail: true, supportPhone: true, businessAddress: true },
      },
      payments: {
        orderBy: { createdAt: 'asc' },
        select: { amount: true, method: true, reference: true, createdAt: true },
      },
    },
  });

  /* A voided invoice is not something a customer should still be looking at,
   * and a draft was never sent — both answer exactly like a wrong token, so
   * this page can't be used to find out which tokens exist. */
  if (!invoice || invoice.status === 'VOID' || invoice.status === 'DRAFT') return null;

  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  const settled = invoice.status === 'PAID' || paid >= total;

  const accounts = settled
    ? []
    : await prisma.merchantBankAccount.findMany({
        where: { organizationId, isActive: true },
        select: { bankName: true, accountName: true, accountNumber: true },
      });

  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    issuedAt: (invoice.sentAt ?? invoice.createdAt).toISOString(),
    dueDate: invoice.dueDate?.toISOString() ?? null,
    overdue: Boolean(invoice.dueDate && invoice.dueDate < new Date() && !settled),
    subtotal: Number(invoice.subtotal),
    taxAmount: Number(invoice.taxAmount),
    totalAmount: total,
    paidAmount: paid,
    outstanding: Math.max(0, total - paid),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    notes: invoice.notes,
    lines: invoice.lineItems.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      totalPrice: Number(line.totalPrice),
    })),
    customer: invoice.customer,
    business: {
      name: invoice.organization.name,
      logoUrl: invoice.organization.logoUrl,
      supportEmail: invoice.organization.supportEmail,
      supportPhone: invoice.organization.supportPhone,
      address: invoice.organization.businessAddress,
    },
    bankAccounts: accounts,
    payments: invoice.payments.map((p) => ({
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference,
      receivedAt: p.createdAt.toISOString(),
    })),
  };
}
