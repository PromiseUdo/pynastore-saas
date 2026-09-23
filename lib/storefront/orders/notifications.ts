/*
 * lib/storefront/orders/notifications.ts
 *
 * Emailing a shopper about their order — and the merchant's staff when the
 * shopper does something they need to answer (cancels, asks for a return).
 * Server only.
 *
 * Called AFTER the change it describes has committed — never from inside a
 * transaction, so an email can't announce something that then rolled back —
 * and never allowed to fail the operation: sendStorefrontOrderUpdateEmail
 * logs and swallows its own errors.
 *
 * The link is the order's confirmation page on the store's own front door
 * (custom domain when there is one). It is unlocked by the confirmation
 * token, so it works for guests and signed-in shoppers alike, on any device.
 */
import { prisma } from '@/lib/prisma';
import { sendStoreOrderAlertEmail, sendStorefrontOrderUpdateEmail } from '@/lib/email';
import type { OrderEmailKind } from '@/emails/storefront-order-update';
import type { StoreOrderAlertKind } from '@/emails/store-order-alert';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { getAdminUrl } from '@/lib/tenant/urls';
import { storeUrl } from '../account/return-url';
import { formatMoney } from '../format';
import { TRANSFER_HOLD_HOURS } from '../mock/checkout';
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

export async function notifyShopper(
  orderId: string,
  kind: OrderEmailKind,
  detail: NotificationDetail = {},
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
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
      },
    });
    if (!order) return;

    /* Counter sales have nobody to write to: no email, no name, no
     * confirmation page to link at. Nothing to send, so nothing is sent —
     * this is not an error. */
    if (!order.email || !order.firstName || !order.confirmationToken) return;

    const money = (value: { toString(): string }) => formatMoney(minor(value), order.currency);
    const returned = detail.returnId ? await returnSummary(detail.returnId, money) : null;

    await sendStorefrontOrderUpdateEmail({
      to: order.email,
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
    });
  } catch (error) {
    console.error(`[orders] Could not email the shopper about order ${orderId} (${kind}):`, error);
  }
}

/**
 * Tell the store's staff that a shopper did something they need to answer.
 *
 * Sent to everyone who can act on it — `sales.fulfillment.manage` for a
 * cancellation, `sales.return.manage` for a return — plus the Owner, who
 * holds every permission whatever their stored role says. Like the shopper's
 * emails it never fails the action that caused it.
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

    const permission =
      kind === 'customer-cancelled' ? PERMISSIONS.SALES_FULFILLMENT_MANAGE : PERMISSIONS.SALES_RETURN_MANAGE;
    const members = await prisma.membership.findMany({
      where: {
        organizationId: order.organizationId,
        status: 'ACTIVE',
        role: {
          OR: [
            { rolePermissions: { some: { permission: { key: permission } } } },
            { isSystem: true, name: SYSTEM_ROLES.OWNER.name },
          ],
        },
      },
      select: { user: { select: { email: true } } },
    });
    const to = [...new Set(members.map((m) => m.user.email).filter((e): e is string => Boolean(e)))];
    if (to.length === 0) return;

    const money = (value: { toString(): string }) => formatMoney(minor(value), order.currency);
    const returned = detail.returnId ? await returnSummary(detail.returnId, money) : null;

    await sendStoreOrderAlertEmail({
      to,
      kind,
      storeName: order.organization.name,
      reference: order.reference,
      customerName: `${order.firstName ?? ''} ${order.lastName ?? ''}`.trim() || order.email || 'A customer',
      orderUrl: getAdminUrl(order.organization.slug, `/sales/orders/${order.id}`),
      total: money(order.totalAmount),
      wasPaid: order.paymentStatus === 'PAID',
      customerNote: kind === 'customer-cancelled' ? (order.cancelNote ?? undefined) : (returned?.details ?? undefined),
      returnReason: returned?.reason,
      lines: returned?.lines,
    });
  } catch (error) {
    console.error(`[orders] Could not email the store about order ${orderId} (${kind}):`, error);
  }
}
