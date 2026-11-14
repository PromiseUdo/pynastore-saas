/*
 * lib/storefront/orders/trade-invoice.ts
 *
 * The business invoice a trade order comes with (ROADMAP 21.6). Server only.
 *
 * It is the ORDER, written up as an invoice — not an `Invoice` record. An
 * invoice record has its own way of sending goods, so making one for a
 * website order would track the same goods twice (Phase 21, decision 6).
 * Its number is the order's reference, and every figure is the one the
 * order stored when it was placed: nothing is worked out again for paper.
 *
 * Only an order an approved trade buyer placed has one (`buyerBusinessName`
 * set at checkout). Anything else — an ordinary shopper's order, a counter
 * sale — answers like a wrong link.
 *
 * Two ways in, both scoped to the store:
 *   - the shopper's: the order's confirmation token, the same 256-bit key as
 *     their confirmation page (the reference beside it is guessable);
 *   - the merchant's: the order id, behind the admin's own permission check.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { PAYMENT_METHOD_LABEL } from '@/lib/sales/order-labels';
import { PAYMENT_STATUS_LABEL } from './labels';
import { readTransferDetails } from './read';
import type { OrderPaymentStatus } from './types';

export interface TradeInvoice {
  /** the order's reference — the invoice number */
  number: string;
  currency: string;
  issuedAt: string;
  cancelled: boolean;
  paymentStatus: OrderPaymentStatus;
  /** "Paid", "Pay on delivery", "Awaiting your transfer"… */
  paymentStatusLabel: string;
  paidAt: string | null;
  /** how the buyer chose to pay, in their words */
  paymentMethodLabel: string;
  seller: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
    /** the shop's VAT number, as recorded on the order (null when it charged no VAT) */
    vatNumber: string | null;
  };
  buyer: {
    businessName: string;
    taxId: string | null;
    cacNumber: string | null;
    contactName: string;
    email: string | null;
    phone: string | null;
  };
  deliverTo: string[];
  deliveryMethod: string | null;
  /** major units throughout, as the order stores them */
  lines: { name: string; variantName: string | null; quantity: number; unitPrice: number; totalPrice: number; atWholesalePrice: boolean }[];
  subtotal: number;
  discount: number;
  discountLabel: string | null;
  deliveryFee: number | null;
  /** delivery to be arranged (21.4B): the fee is the store's own, or not set yet (`deliveryFee` null) */
  deliveryArranged: boolean;
  /** VAT added on top of wholesale prices (21.2) */
  vatAdded: number;
  /** VAT already inside the prices (14.1) */
  vatIncluded: number;
  total: number;
  /** pay on account (21.5): due by, paid so far, still to pay (major units); null otherwise */
  account: { dueAt: string | null; paid: number; outstanding: number; overdue: boolean } | null;
  /** where a transfer goes, while one is still awaited — the accounts the order was placed with */
  transferAccounts: { bankName: string; accountName: string; accountNumber: string }[];
}

/** How the buyer paid or will pay, in a buyer's words (the admin's labels are the merchant's). */
const METHOD_LABEL: Record<string, string> = {
  paystack: 'Online payment',
  pod: 'Pay on delivery',
  transfer: 'Bank transfer',
  account: 'On account',
};

const SELECT = {
  reference: true,
  organizationId: true,
  currency: true,
  placedAt: true,
  createdAt: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  paidAt: true,
  transferDetails: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  shipFullName: true,
  shipLine1: true,
  shipLine2: true,
  shipCity: true,
  shipState: true,
  shipCountry: true,
  deliveryMethodLabel: true,
  subtotal: true,
  discount: true,
  discountCodeLabel: true,
  discountCode: true,
  deliveryFee: true,
  deliveryArranged: true,
  taxAmount: true,
  vatAddedAmount: true,
  vatNumber: true,
  totalAmount: true,
  buyerBusinessName: true,
  buyerTaxId: true,
  buyerCacNumber: true,
  accountDueAt: true,
  accountPaidAmount: true,
  organization: {
    select: { name: true, logoUrl: true, supportEmail: true, supportPhone: true, businessAddress: true },
  },
  lineItems: {
    select: { name: true, variantName: true, quantity: true, unitPrice: true, totalPrice: true, atWholesalePrice: true },
  },
} satisfies Prisma.OrderSelect;

async function read(where: Prisma.OrderWhereInput): Promise<TradeInvoice | null> {
  const order = await prisma.order.findFirst({
    // A trade order, and an online one: only checkout writes the business.
    where: { ...where, channel: 'ONLINE', buyerBusinessName: { not: null } },
    select: SELECT,
  });
  if (!order || !order.buyerBusinessName) return null;

  const paymentStatus = order.paymentStatus as OrderPaymentStatus;
  const tax = Number(order.taxAmount);
  const added = Number(order.vatAddedAmount);
  const awaitingTransfer = paymentStatus === 'AWAITING_TRANSFER' && order.status !== 'CANCELLED';
  // On account (21.5) and still owing: where to send it — the shop's published accounts, as an invoice shows.
  const owingOnAccount = paymentStatus === 'ON_ACCOUNT' && order.status !== 'CANCELLED';
  const shopAccounts = owingOnAccount
    ? await prisma.merchantBankAccount.findMany({
        where: { organizationId: order.organizationId, isActive: true },
        select: { bankName: true, accountName: true, accountNumber: true },
      })
    : [];

  return {
    number: order.reference,
    currency: order.currency,
    issuedAt: (order.placedAt ?? order.createdAt).toISOString(),
    cancelled: order.status === 'CANCELLED',
    paymentStatus,
    paymentStatusLabel: PAYMENT_STATUS_LABEL[paymentStatus] ?? 'Awaiting payment',
    paidAt: order.paidAt?.toISOString() ?? null,
    paymentMethodLabel: METHOD_LABEL[order.paymentMethod] ?? PAYMENT_METHOD_LABEL[order.paymentMethod] ?? 'Other',
    seller: {
      name: order.organization.name,
      logoUrl: order.organization.logoUrl,
      address: order.organization.businessAddress,
      supportEmail: order.organization.supportEmail,
      supportPhone: order.organization.supportPhone,
      vatNumber: order.vatNumber,
    },
    buyer: {
      businessName: order.buyerBusinessName,
      taxId: order.buyerTaxId,
      cacNumber: order.buyerCacNumber,
      contactName: [order.firstName, order.lastName].filter(Boolean).join(' '),
      email: order.email,
      phone: order.phone,
    },
    deliverTo: [
      order.shipFullName,
      order.shipLine1,
      order.shipLine2,
      [order.shipCity, order.shipState].filter(Boolean).join(', '),
      order.shipCountry,
    ].filter((part): part is string => Boolean(part)),
    deliveryMethod: order.deliveryMethodLabel,
    lines: order.lineItems.map((line) => ({
      name: line.name,
      variantName: line.variantName,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice),
      totalPrice: Number(line.totalPrice),
      atWholesalePrice: line.atWholesalePrice,
    })),
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    discountLabel: order.discountCodeLabel ?? order.discountCode,
    deliveryFee: order.deliveryFee === null ? null : Number(order.deliveryFee),
    deliveryArranged: order.deliveryArranged,
    vatAdded: added,
    vatIncluded: Math.max(0, tax - added),
    total: Number(order.totalAmount),
    transferAccounts: awaitingTransfer ? (readTransferDetails(order.transferDetails) ?? []) : shopAccounts,
    account:
      order.paymentMethod === 'account'
        ? {
            dueAt: order.accountDueAt?.toISOString() ?? null,
            paid: Number(order.accountPaidAmount),
            outstanding: Math.max(0, Math.round((Number(order.totalAmount) - Number(order.accountPaidAmount)) * 100) / 100),
            overdue: paymentStatus === 'ON_ACCOUNT' && Boolean(order.accountDueAt && order.accountDueAt < new Date()),
          }
        : null,
  };
}

/** The buyer's copy, by the order's confirmation token. Null for a wrong token or a non-trade order. */
export async function tradeInvoiceByToken(organizationId: string, token: string | null | undefined): Promise<TradeInvoice | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  return read({ organizationId, confirmationToken: trimmed });
}

/** The merchant's copy. The caller has already checked `sales.view`. */
export async function tradeInvoiceForOrder(organizationId: string, orderId: string): Promise<TradeInvoice | null> {
  return read({ organizationId, id: orderId });
}

/** The page a buyer opens their invoice at, relative to the store's front door. */
export function tradeInvoicePath(confirmationToken: string): string {
  return `/order-invoice/${encodeURIComponent(confirmationToken)}`;
}
