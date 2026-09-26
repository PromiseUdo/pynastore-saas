/*
 * lib/storefront/orders/read.ts
 *
 * Reading placed orders back.
 *
 * WHO MAY SEE AN ORDER is decided here, once, and it is the only question
 * that matters in this file:
 *
 *   an account holder   their own orders, by customer id.
 *   a guest             one order, and only by knowing BOTH its reference
 *                       and the email it was placed with. A reference alone
 *                       is a number someone could guess at; a reference plus
 *                       the address it was sent to is not.
 *
 * Every query is also scoped to the store, so a reference from one merchant
 * is meaningless at another — the same rule the rest of the storefront
 * follows.
 *
 * Money crosses back here: the database holds major units, the storefront
 * works in minor ones.
 */
import { MINUTES_PER_UNIT, type DeliveryEta } from '../delivery/eta';
import type { TransferAccount } from '../checkout/types';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '../account/shopper';
import type { Money } from '../types';
import type {
  OrderPaymentStatus,
  OrderReturnStatus,
  OrderStatus,
  StorefrontOrder,
  StorefrontOrderLine,
} from './types';
import { RETURN_REASONS, customerCanCancel, countsAgainstReturnable, isReturnReason, returnDeadline, returnEligibility } from './policy';

/** ₦5,000.00 (Decimal) → 500000 kobo. */
function toMinor(value: Prisma.Decimal | number): Money {
  return Math.round(Number(value) * 100);
}

/*
 * A shopper only ever sees what they bought on the website.
 *
 * Since Phase 2 an Order can also be a counter sale (channel WALK_IN /
 * PHONE), which has no delivery, no shipping address and often no email —
 * their columns are nullable now. Every query in this file therefore filters
 * on ONLINE, which keeps those columns present in practice and keeps this
 * file's promises to a shopper true: a track-order lookup can't surface an
 * in-store purchase, and an account's order list can't show a row with
 * nothing to track.
 *
 * A merchant sees every channel — that's features/sales/orders.ts.
 */
const ONLINE_ONLY = 'ONLINE' as const;

/**
 * The columns an ONLINE order is guaranteed to have. Reached only if a row
 * got past the channel filter above without them, which would mean a writer
 * has created an online order by some path that skipped checkout — worth a
 * loud failure rather than "undefined" on a shopper's receipt.
 */
function onlineField<T>(value: T | null, column: string, reference: string): T {
  if (value === null) {
    throw new Error(`Order ${reference} is ONLINE but has no ${column}`);
  }
  return value;
}

const ORDER_SELECT = {
  reference: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  transferDetails: true,
  placedAt: true,
  confirmedAt: true,
  packingAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancelReason: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  shipFullName: true,
  shipPhone: true,
  shipLine1: true,
  shipLine2: true,
  shipCity: true,
  shipState: true,
  shipCountry: true,
  shipPostalCode: true,
  deliveryMethodId: true,
  deliveryMethodLabel: true,
  deliveryFee: true,
  deliveryEtaMinMinutes: true,
  deliveryEtaMaxMinutes: true,
  deliveryEtaUnit: true,
  currency: true,
  subtotal: true,
  discount: true,
  discountCode: true,
  taxAmount: true,
  totalAmount: true,
  note: true,
  organization: { select: { returnWindowDays: true } },
  refunds: { select: { amount: true, returnId: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  returns: {
    orderBy: { requestedAt: 'desc' },
    select: {
      id: true,
      status: true,
      reason: true,
      details: true,
      merchantNote: true,
      requestedAt: true,
      approvedAt: true,
      rejectedAt: true,
      refundedAt: true,
      withdrawnAt: true,
      lines: { select: { orderLineItemId: true, quantity: true } },
    },
  },
  lineItems: {
    select: {
      id: true,
      productId: true,
      variantId: true,
      name: true,
      variantName: true,
      sku: true,
      imageUrl: true,
      slug: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
    },
  },
} as const;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

/**
 * The delivery window as two dates, from when the order was placed.
 *
 * A window measured in working days skips weekends, so a Friday "2 working
 * days" order doesn't promise Sunday. A window measured in minutes or hours
 * is a rider on the road: it runs from the clock, weekend or not. Either way
 * it's the same window the checkout quoted, because the order stores it.
 */
function estimateWindow(placedAt: Date, value: DeliveryEta) {
  const addWorkingDays = (minutes: number) => {
    const date = new Date(placedAt);
    let remaining = Math.round(minutes / MINUTES_PER_UNIT.DAYS);
    while (remaining > 0) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      if (day !== 0 && day !== 6) remaining -= 1;
    }
    return date.toISOString();
  };
  const addMinutes = (minutes: number) => new Date(placedAt.getTime() + minutes * 60_000).toISOString();
  const add = value.unit === 'DAYS' ? addWorkingDays : addMinutes;

  return { from: add(value.minMinutes), to: add(value.maxMinutes) };
}

/** The JSON snapshot, defensively: only well-formed accounts come out. */
export function readTransferDetails(value: unknown): TransferAccount[] | null {
  if (!Array.isArray(value)) return null;
  const accounts = value.filter(
    (a): a is TransferAccount =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as TransferAccount).bankName === 'string' &&
      typeof (a as TransferAccount).accountName === 'string' &&
      typeof (a as TransferAccount).accountNumber === 'string',
  );
  return accounts.length ? accounts : null;
}

const CANCELLED_BY: Record<string, 'customer' | 'merchant' | 'payment-timeout'> = {
  customer: 'customer',
  merchant: 'merchant',
  'payment-timeout': 'payment-timeout',
};

function toStorefrontOrder(row: OrderRow, now = new Date()): StorefrontOrder {
  const lines: StorefrontOrderLine[] = row.lineItems.map((line) => ({
    id: line.id,
    productId: line.productId,
    variantId: line.variantId,
    name: line.name,
    variantName: line.variantName,
    sku: line.sku,
    imageUrl: line.imageUrl,
    slug: line.slug,
    quantity: line.quantity,
    unitPrice: toMinor(line.unitPrice),
    totalPrice: toMinor(line.totalPrice),
  }));

  /* Refunds, and what a cancelled paid order still owes. */
  const refundedMinor = row.refunds.reduce((sum, r) => sum + toMinor(r.amount), 0);
  const refundedByReturn = new Map<string, Money>();
  for (const refund of row.refunds) {
    if (refund.returnId) refundedByReturn.set(refund.returnId, (refundedByReturn.get(refund.returnId) ?? 0) + toMinor(refund.amount));
  }
  const paidAndCancelled =
    row.status === 'CANCELLED' && (row.paymentStatus === 'PAID' || row.paymentStatus === 'PARTIALLY_REFUNDED');
  const owed = paidAndCancelled ? Math.max(0, toMinor(row.totalAmount) - refundedMinor) : 0;

  /* Returns, and what's left of each line to send back. */
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const returned = new Map<string, number>();
  for (const r of row.returns) {
    if (!countsAgainstReturnable(r.status)) continue;
    for (const line of r.lines) returned.set(line.orderLineItemId, (returned.get(line.orderLineItemId) ?? 0) + line.quantity);
  }
  const windowDays = row.organization.returnWindowDays;
  const eligibility = returnEligibility({
    status: row.status,
    deliveredAt: row.deliveredAt,
    windowDays,
    lines: lines.map((line) => ({ id: line.id, quantity: line.quantity, returned: returned.get(line.id) ?? 0 })),
    now,
  });

  const deliveryEta: DeliveryEta = {
    minMinutes: onlineField(row.deliveryEtaMinMinutes, 'deliveryEtaMinMinutes', row.reference),
    maxMinutes: onlineField(row.deliveryEtaMaxMinutes, 'deliveryEtaMaxMinutes', row.reference),
    unit: onlineField(row.deliveryEtaUnit, 'deliveryEtaUnit', row.reference),
  };

  return {
    reference: row.reference,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus as OrderPaymentStatus,
    paymentMethodId: row.paymentMethod,
    transferDetails: readTransferDetails(row.transferDetails),
    placedAt: row.placedAt.toISOString(),
    stageDates: {
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      packingAt: row.packingAt?.toISOString() ?? null,
      shippedAt: row.shippedAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
    },

    contact: {
      firstName: onlineField(row.firstName, 'firstName', row.reference),
      lastName: onlineField(row.lastName, 'lastName', row.reference),
      email: onlineField(row.email, 'email', row.reference),
      phone: onlineField(row.phone, 'phone', row.reference),
    },

    shippingAddress: {
      fullName: onlineField(row.shipFullName, 'shipFullName', row.reference),
      phone: onlineField(row.shipPhone, 'shipPhone', row.reference),
      line1: onlineField(row.shipLine1, 'shipLine1', row.reference),
      line2: row.shipLine2,
      city: onlineField(row.shipCity, 'shipCity', row.reference),
      state: onlineField(row.shipState, 'shipState', row.reference),
      country: onlineField(row.shipCountry, 'shipCountry', row.reference),
      postalCode: row.shipPostalCode,
    },

    delivery: {
      methodId: onlineField(row.deliveryMethodId, 'deliveryMethodId', row.reference),
      label: onlineField(row.deliveryMethodLabel, 'deliveryMethodLabel', row.reference),
      fee: toMinor(row.deliveryFee ?? 0),
      eta: deliveryEta,
      estimated: estimateWindow(row.placedAt, deliveryEta),
    },

    currency: row.currency,
    totals: {
      subtotal: toMinor(row.subtotal),
      discount: toMinor(row.discount),
      shipping: toMinor(row.deliveryFee ?? 0),
      tax: toMinor(row.taxAmount),
      total: toMinor(row.totalAmount),
    },
    discountCode: row.discountCode,

    note: row.note,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),

    cancellation:
      row.status === 'CANCELLED'
        ? { by: CANCELLED_BY[row.cancelReason ?? ''] ?? 'merchant', at: row.cancelledAt?.toISOString() ?? null }
        : null,
    refunds: {
      total: refundedMinor,
      owed,
      lastAt: row.refunds.at(-1)?.createdAt.toISOString() ?? null,
    },
    returns: row.returns.map((r) => ({
      id: r.id,
      status: r.status as OrderReturnStatus,
      reasonLabel: isReturnReason(r.reason) ? RETURN_REASONS[r.reason] : r.reason,
      details: r.details,
      storeNote: r.merchantNote,
      requestedAt: r.requestedAt.toISOString(),
      updatedAt: (r.refundedAt ?? r.rejectedAt ?? r.approvedAt ?? r.withdrawnAt)?.toISOString() ?? null,
      refunded: refundedByReturn.get(r.id) ?? null,
      lines: r.lines.map((line) => ({
        orderLineItemId: line.orderLineItemId,
        name: lineById.get(line.orderLineItemId)?.name ?? 'Item',
        variantName: lineById.get(line.orderLineItemId)?.variantName ?? null,
        quantity: line.quantity,
      })),
    })),
    selfService: {
      canCancel: customerCanCancel(row.status),
      returns: eligibility.ok
        ? { open: true, deadline: eligibility.deadline.toISOString(), remaining: Object.fromEntries(eligibility.remaining) }
        : {
            open: false,
            reason: eligibility.reason,
            deadline: returnDeadline(row.deliveredAt, windowDays)?.toISOString() ?? null,
          },
    },
  };
}

export interface OrderScope {
  organizationId: string;
}

/** A shopper's own orders, newest first. */
export async function listOrdersForCustomer(
  scope: OrderScope,
  customerId: string,
  limit = 50,
): Promise<StorefrontOrder[]> {
  const rows = await prisma.order.findMany({
    where: { organizationId: scope.organizationId, customerId, channel: ONLINE_ONLY },
    orderBy: { placedAt: 'desc' },
    take: limit,
    select: ORDER_SELECT,
  });

  return rows.map((row) => toStorefrontOrder(row));
}

/** One of a shopper's own orders. Their id is the permission. */
export async function getOrderForCustomer(
  scope: OrderScope,
  customerId: string,
  reference: string,
): Promise<StorefrontOrder | null> {
  const row = await prisma.order.findFirst({
    where: { organizationId: scope.organizationId, customerId, reference: reference.trim(), channel: ONLINE_ONLY },
    select: ORDER_SELECT,
  });

  return row ? toStorefrontOrder(row) : null;
}

/**
 * Look an order up the way a guest has to: reference AND email, both.
 *
 * The email is compared normalised, and a mismatch reads exactly like a
 * missing order — the caller says one thing for both, so this can't be used
 * to find out which references exist.
 */
export async function findOrderByReferenceAndEmail(
  scope: OrderScope,
  reference: string,
  email: string,
): Promise<StorefrontOrder | null> {
  const trimmed = reference.trim();
  const normalized = normalizeEmail(email);
  if (!trimmed || !normalized) return null;

  const row = await prisma.order.findFirst({
    where: {
      organizationId: scope.organizationId,
      reference: trimmed,
      email: normalized,
      channel: ONLINE_ONLY,
    },
    select: ORDER_SELECT,
  });

  return row ? toStorefrontOrder(row) : null;
}

/**
 * The just-placed order, for the confirmation page.
 *
 * Deliberately NOT protected by a session — a guest lands here seconds after
 * ordering and must see their own confirmation. The lock is the token in the
 * URL, which is random and 256 bits wide. The reference is NOT accepted here
 * for exactly that reason: it counts upwards, so accepting it would let
 * anyone read the whole store's orders by editing a number.
 */
export async function getOrderByConfirmationToken(
  scope: OrderScope,
  token: string,
): Promise<StorefrontOrder | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const row = await prisma.order.findFirst({
    where: { organizationId: scope.organizationId, confirmationToken: trimmed, channel: ONLINE_ONLY },
    select: ORDER_SELECT,
  });

  return row ? toStorefrontOrder(row) : null;
}
