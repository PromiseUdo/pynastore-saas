/*
 * lib/storefront/orders/notifications.ts
 *
 * Telling a shopper about their order — and the merchant's staff when the
 * shopper does something they need to answer (cancels, asks for a return).
 * Server only.
 *
 * This builds what the email says; who hears and how (email, their phone in
 * the store's app, their browser, their notification list) is decided by the
 * notification seam (lib/notifications, ROADMAP 18).
 *
 * Called AFTER the change it describes has committed — never from inside a
 * transaction, so nothing can announce something that then rolled back —
 * and never allowed to fail the operation: notify() never throws.
 *
 * The link is the order's confirmation page on the store's own front door
 * (custom domain when there is one). It is unlocked by the confirmation
 * token, so it works for guests and signed-in shoppers alike, on any device.
 */
import { prisma } from '@/lib/prisma';
import { notify, type NotifyResult } from '@/lib/notifications/notify';
import type { OrderEmailKind } from '@/emails/storefront-order-update';
import type { StoreOrderAlertKind } from '@/emails/store-order-alert';
import { getAdminUrl } from '@/lib/tenant/urls';
import { storeUrl } from '../account/return-url';
import { formatMoney } from '../format';
import { TRANSFER_HOLD_HOURS } from './holds';
import { readTransferDetails } from './read';
import { RETURN_REASONS, isReturnReason } from './policy';

/** Decimal major units → minor units, for the storefront's money formatter. */
const minor = (value: { toString(): string }) => Math.round(Number(value.toString()) * 100);

/** What a return or refund email is about, beyond the order itself. */
export interface NotificationDetail {
  returnId?: string;
  /** major units */
  refundAmount?: number;
}

async function returnSummary(returnId: string, money: (value: { toString(): string }) => string) {
  const row = await prisma.orderReturn.findUnique({
    where: { id: returnId },
    select: {
      reason: true,
      details: true,
      merchantNote: true,
      lines: {
        select: {
          quantity: true,
          lineItem: { select: { name: true, variantName: true, unitPrice: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    reason: isReturnReason(row.reason) ? RETURN_REASONS[row.reason] : row.reason,
    details: row.details,
    merchantNote: row.merchantNote,
    lines: row.lines.map((line) => ({
      name: line.lineItem.variantName ? `${line.lineItem.name} (${line.lineItem.variantName})` : line.lineItem.name,
      quantity: line.quantity,
      total: money(Number(line.lineItem.unitPrice) * line.quantity),
    })),
  };
}

/** What was sent, or null when there was nobody to tell (a counter sale) or it failed. */
export async function notifyShopper(
  orderId: string,
  kind: OrderEmailKind,
  detail: NotificationDetail = {},
): Promise<NotifyResult | null> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        organizationId: true,
        reference: true,
        confirmationToken: true,
        email: true,
        firstName: true,
        currency: true,
        totalAmount: true,
        paymentStatus: true,
        transferDetails: true,
        deliveryMethodLabel: true,
        shipFullName: true,
        shipLine1: true,
        shipLine2: true,
        shipCity: true,
        shipState: true,
        shipCountry: true,
        organization: { select: { name: true, slug: true, customStoreDomain: true } },
        lineItems: { select: { name: true, variantName: true, quantity: true, totalPrice: true } },
        shipments: {
          orderBy: { sortOrder: 'asc' },
          select: { deliveryMethodLabel: true, warehouse: { select: { name: true } } },
        },
      },
    });
    if (!order) return null;

    /* Counter sales have nobody to write to: no email, no name, no
     * confirmation page to link at. Nothing to send, so nothing is sent —
     * this is not an error. */
    if (!order.email || !order.firstName || !order.confirmationToken) return null;

    const money = (value: { toString(): string }) => formatMoney(minor(value), order.currency);
    const returned = detail.returnId ? await returnSummary(detail.returnId, money) : null;

    return await notify({
      kind: 'order.update',
      organizationId: order.organizationId,
      facts: {
        kind,
        orderId,
        reference: order.reference,
        confirmationToken: order.confirmationToken,
        returnId: detail.returnId,
        storeName: order.organization.name,
      },
      email: {
        template: 'storefront-order-update',
        props: {
          kind,
          storeName: order.organization.name,
          firstName: order.firstName,
          reference: order.reference,
          orderUrl: storeUrl(
            order.organization,
            `/checkout/confirmation?t=${encodeURIComponent(order.confirmationToken)}`,
          ),
          total: money(order.totalAmount),
          /* A return's email lists what is going back, not the whole order. */
          lines:
            returned?.lines ??
            order.lineItems.map((line) => ({
              name: line.variantName ? `${line.name} (${line.variantName})` : line.name,
              quantity: line.quantity,
              total: money(line.totalPrice),
            })),
          returnReason: returned?.reason,
          storeNote: returned?.merchantNote ?? undefined,
          refundAmount: detail.refundAmount !== undefined ? money(detail.refundAmount) : undefined,
          deliveryLabel: order.deliveryMethodLabel ?? '',
          parcels: order.shipments.map((s) => (s.warehouse ? `from ${s.warehouse.name}: ${s.deliveryMethodLabel}` : s.deliveryMethodLabel)),
          address: [
            order.shipFullName,
            order.shipLine1,
            order.shipLine2,
            [order.shipCity, order.shipState].filter(Boolean).join(', '),
            order.shipCountry,
          ].filter((part): part is string => Boolean(part)),
          wasPaid: order.paymentStatus === 'PAID',
          transferAccounts: readTransferDetails(order.transferDetails) ?? undefined,
          transferHoldHours: TRANSFER_HOLD_HOURS,
        },
      },
    });
  } catch (error) {
    console.error(`[orders] Could not tell the shopper about order ${orderId} (${kind}):`, error);
    return null;
  }
}

/**
 * Tell the store's staff that a shopper did something they need to answer.
 *
 * Sent to everyone who can act on it — `sales.fulfillment.manage` for a
 * cancellation, `sales.return.manage` for a return — plus the Owner, who
 * holds every permission whatever their stored role says (the 'order.alert'
 * event, lib/notifications/events.ts). It never fails the action that
 * caused it.
 */
export async function notifyMerchant(
  orderId: string,
  kind: StoreOrderAlertKind,
  detail: NotificationDetail = {},
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        email: true,
        currency: true,
        totalAmount: true,
        paymentStatus: true,
        cancelNote: true,
        organizationId: true,
        organization: { select: { name: true, slug: true } },
      },
    });
    if (!order) return;

    const money = (value: { toString(): string }) => formatMoney(minor(value), order.currency);
    const returned = detail.returnId ? await returnSummary(detail.returnId, money) : null;
    const customerName = `${order.firstName ?? ''} ${order.lastName ?? ''}`.trim() || order.email || 'A customer';

    await notify({
      kind: 'order.alert',
      organizationId: order.organizationId,
      facts: { kind, orderId: order.id, reference: order.reference, returnId: detail.returnId, customerName },
      email: {
        template: 'store-order-alert',
        props: {
          kind,
          storeName: order.organization.name,
          reference: order.reference,
          customerName,
          orderUrl: getAdminUrl(order.organization.slug, `/sales/orders/${order.id}`),
          total: money(order.totalAmount),
          wasPaid: order.paymentStatus === 'PAID',
          customerNote: kind === 'customer-cancelled' ? (order.cancelNote ?? undefined) : (returned?.details ?? undefined),
          returnReason: returned?.reason,
          lines: returned?.lines,
        },
      },
    });
  } catch (error) {
    console.error(`[orders] Could not tell the store about order ${orderId} (${kind}):`, error);
  }
}

/**
 * Tell the store there's an online order to deal with (ROADMAP 18.6) — once,
 * when it needs them: an order to be paid on delivery when it's placed, an
 * online payment when it has gone through (an unpaid one may never be), and
 * a bank transfer when it's placed, asking them to confirm the money. To
 * whoever handles orders, and the Owner ('order.new', 'order.transfer').
 */
export async function notifyStoreOfOrder(orderId: string, kind: 'paid' | 'on-delivery' | 'transfer'): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, reference: true, organizationId: true, firstName: true, lastName: true, email: true, currency: true, totalAmount: true },
    });
    if (!order) return;
    const customerName = `${order.firstName ?? ''} ${order.lastName ?? ''}`.trim() || order.email || 'A customer';
    const total = formatMoney(minor(order.totalAmount), order.currency);
    const facts = { orderId: order.id, reference: order.reference, customerName, total };
    await (kind === 'transfer'
      ? notify({ kind: 'order.transfer', organizationId: order.organizationId, key: `order:${order.id}:new`, facts })
      : notify({ kind: 'order.new', organizationId: order.organizationId, key: `order:${order.id}:new`, facts: { ...facts, payment: kind } }));
  } catch (error) {
    console.error(`[orders] Could not tell the store about new order ${orderId}:`, error);
  }
}
