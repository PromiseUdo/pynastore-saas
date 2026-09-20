'use server';

/*
 * features/sales/orders.ts
 *
 * Online-store orders, for the merchant.
 *
 * The storefront writes these (lib/storefront/orders/create.ts); this is the
 * admin's read of the same table, scoped to the signed-in staff member's
 * organization and gated on `sales.view` like every other sales screen.
 *
 * Money comes back as a plain number in MAJOR units, which is what the admin
 * formats with `formatMoney` — the storefront's minor-unit convention stops
 * at the storefront.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import {
  cancelOrder,
  confirmOrder,
  confirmTransferReceived,
  startPacking,
  expireUnpaidOrders,
  markOrderDelivered,
  markOrderShipped,
  recordDeliveryPayment,
  type TransitionResult,
} from '@/lib/storefront/orders/lifecycle';
import { readTransferDetails } from '@/lib/storefront/orders/read';
import { RETURN_REASONS, isReturnReason, refundableAmount, suggestedReturnRefund } from '@/lib/storefront/orders/policy';
import type { ActionResult } from './shared';

export interface StoreOrderRow {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: string;
  customerName: string;
  customerEmail: string;
  isGuest: boolean;
  itemCount: number;
  currency: string;
  totalAmount: number;
  city: string;
  state: string;
  /** return requests waiting on the merchant */
  returnsAwaiting: number;
  /** cancelled after it was paid, and not all of it sent back yet */
  refundOwed: boolean;
}

export interface StoreOrderDetail extends StoreOrderRow {
  /** bank transfer orders: the account details the customer was given */
  transferDetails: { bankName: string; accountName: string; accountNumber: string }[] | null;
  paidAt: string | null;
  cancelReason: string | null;
  /** the customer's own words, when they cancelled it themselves */
  cancelNote: string | null;
  /** what the merchant has recorded sending back, newest last */
  refunds: { id: string; amount: number; note: string | null; createdAt: string; returnId: string | null }[];
  refundedTotal: number;
  /** what could still be refunded: paid money not yet sent back */
  refundable: number;
  returns: StoreOrderReturn[];
  confirmedAt: string | null;
  packingAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  /** units still held for this order, and units already sent */
  stock: { held: number; dispatched: number };
  customerId: string;
  phone: string;
  shipFullName: string;
  shipPhone: string;
  shipLine1: string;
  shipLine2: string | null;
  shipCountry: string;
  shipPostalCode: string | null;
  deliveryMethodLabel: string;
  deliveryFee: number;
  subtotal: number;
  discount: number;
  /** the code the shopper used, as it was when they used it */
  discountCode: string | null;
  taxAmount: number;
  note: string | null;
  lines: {
    id: string;
    name: string;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    productId: string | null;
  }[];
}

export interface StoreOrderReturn {
  id: string;
  status: string;
  reasonLabel: string;
  details: string | null;
  merchantNote: string | null;
  restocked: boolean;
  requestedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  refundedAt: string | null;
  withdrawnAt: string | null;
  /** the lines' value less their share of the discount — a starting point for the refund */
  suggestedRefund: number;
  /** whether any returned line can go back on a shelf (it was sent from one) */
  canRestock: boolean;
  lines: { id: string; name: string; variantName: string | null; quantity: number; unitPrice: number }[];
}

export async function listStoreOrders(): Promise<ActionResult<StoreOrderRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    /* Unpaid online orders past their hold are cancelled before the list is
     * read, so the merchant never sees stock held by an abandoned checkout. */
    await expireUnpaidOrders({ organizationId: ctx.organization.id, limit: 20 }).catch((error) => {
      console.error('[orders] Could not expire unpaid orders:', error);
    });

    const orders = await prisma.order.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: { placedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        reference: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        placedAt: true,
        isGuest: true,
        email: true,
        firstName: true,
        lastName: true,
        currency: true,
        totalAmount: true,
        shipCity: true,
        shipState: true,
        lineItems: { select: { quantity: true } },
        _count: { select: { returns: { where: { status: 'REQUESTED' } } } },
      },
    });

    return {
      success: true,
      data: orders.map((order) => ({
        id: order.id,
        reference: order.reference,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        placedAt: order.placedAt.toISOString(),
        customerName: `${order.firstName} ${order.lastName}`.trim(),
        customerEmail: order.email,
        isGuest: order.isGuest,
        itemCount: order.lineItems.reduce((sum, line) => sum + line.quantity, 0),
        currency: order.currency,
        totalAmount: Number(order.totalAmount),
        city: order.shipCity,
        state: order.shipState,
        returnsAwaiting: order._count.returns,
        refundOwed:
          order.status === 'CANCELLED' &&
          (order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED'),
      })),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load orders' };
  }
}

export async function getStoreOrder(orderId: string): Promise<ActionResult<StoreOrderDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const order = await prisma.order.findFirst({
      where: { id: orderId, organizationId: ctx.organization.id },
      include: {
        lineItems: true,
        allocations: { select: { status: true, quantity: true, orderLineItemId: true } },
        refunds: { orderBy: { createdAt: 'asc' } },
        returns: {
          orderBy: { requestedAt: 'desc' },
          include: { lines: { include: { lineItem: { select: { name: true, variantName: true, unitPrice: true } } } } },
        },
      },
    });

    if (!order) return { success: false, error: 'Order not found' };

    const refundedTotal = order.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    const dispatchedLines = new Set(
      order.allocations.filter((a) => a.status === 'DISPATCHED').map((a) => a.orderLineItemId),
    );

    return {
      success: true,
      data: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        placedAt: order.placedAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
        cancelReason: order.cancelReason,
        cancelNote: order.cancelNote,
        refunds: order.refunds.map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          returnId: r.returnId,
        })),
        refundedTotal,
        returnsAwaiting: order.returns.filter((r) => r.status === 'REQUESTED').length,
        refundOwed:
          order.status === 'CANCELLED' &&
          (order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED'),
        refundable: refundableAmount({
          paymentStatus: order.paymentStatus,
          total: Number(order.totalAmount),
          refunded: refundedTotal,
        }),
        returns: order.returns.map((r) => ({
          id: r.id,
          status: r.status,
          reasonLabel: isReturnReason(r.reason) ? RETURN_REASONS[r.reason] : r.reason,
          details: r.details,
          merchantNote: r.merchantNote,
          restocked: r.restocked,
          requestedAt: r.requestedAt.toISOString(),
          approvedAt: r.approvedAt?.toISOString() ?? null,
          rejectedAt: r.rejectedAt?.toISOString() ?? null,
          refundedAt: r.refundedAt?.toISOString() ?? null,
          withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
          suggestedRefund: suggestedReturnRefund({
            subtotal: Number(order.subtotal),
            discount: Number(order.discount),
            lines: r.lines.map((line) => ({ unitPrice: Number(line.lineItem.unitPrice), quantity: line.quantity })),
          }),
          canRestock: r.lines.some((line) => dispatchedLines.has(line.orderLineItemId)),
          lines: r.lines.map((line) => ({
            id: line.id,
            name: line.lineItem.name,
            variantName: line.lineItem.variantName,
            quantity: line.quantity,
            unitPrice: Number(line.lineItem.unitPrice),
          })),
        })),
        confirmedAt: order.confirmedAt?.toISOString() ?? null,
        packingAt: order.packingAt?.toISOString() ?? null,
        shippedAt: order.shippedAt?.toISOString() ?? null,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        transferDetails: readTransferDetails(order.transferDetails),
        stock: {
          held: order.allocations
            .filter((a) => a.status === 'RESERVED')
            .reduce((sum, a) => sum + Number(a.quantity), 0),
          dispatched: order.allocations
            .filter((a) => a.status === 'DISPATCHED')
            .reduce((sum, a) => sum + Number(a.quantity), 0),
        },
        customerId: order.customerId,
        customerName: `${order.firstName} ${order.lastName}`.trim(),
        customerEmail: order.email,
        isGuest: order.isGuest,
        phone: order.phone,
        shipFullName: order.shipFullName,
        shipPhone: order.shipPhone,
        shipLine1: order.shipLine1,
        shipLine2: order.shipLine2,
        city: order.shipCity,
        state: order.shipState,
        shipCountry: order.shipCountry,
        shipPostalCode: order.shipPostalCode,
        deliveryMethodLabel: order.deliveryMethodLabel,
        deliveryFee: Number(order.deliveryFee),
        currency: order.currency,
        subtotal: Number(order.subtotal),
        discount: Number(order.discount),
        discountCode: order.discountCode,
        taxAmount: Number(order.taxAmount),
        totalAmount: Number(order.totalAmount),
        itemCount: order.lineItems.reduce((sum, line) => sum + line.quantity, 0),
        note: order.note,
        lines: order.lineItems.map((line) => ({
          id: line.id,
          name: line.name,
          variantName: line.variantName,
          quantity: line.quantity,
          unitPrice: Number(line.unitPrice),
          totalPrice: Number(line.totalPrice),
          productId: line.productId,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load order' };
  }
}

/* ---------------- moving an order along ---------------- */

export type StoreOrderAction =
  | 'confirm'
  | 'confirm-transfer'
  | 'pack'
  | 'ship'
  | 'deliver'
  | 'record-payment'
  | 'cancel';

/**
 * One entry point for the order page's buttons. Each move is decided and
 * applied by lib/storefront/orders/lifecycle.ts (stock, payment state and the
 * shopper's email go together); this only checks who is asking.
 */
export async function updateStoreOrder(
  orderId: string,
  action: StoreOrderAction,
  options: { paymentCollected?: boolean } = {},
): Promise<ActionResult<{ warning: string | null }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_FULFILLMENT_MANAGE);

    const scope = { organizationId: ctx.organization.id, orderId };
    let result: TransitionResult;

    switch (action) {
      case 'confirm':
        result = await confirmOrder(scope);
        break;
      case 'confirm-transfer':
        result = await confirmTransferReceived(scope);
        break;
      case 'pack':
        result = await startPacking(scope);
        break;
      case 'ship':
        result = await markOrderShipped({
          ...scope,
          organizationSlug: ctx.organization.slug,
          performedById: ctx.userId,
        });
        break;
      case 'deliver':
        result = await markOrderDelivered({ ...scope, paymentCollected: options.paymentCollected });
        break;
      case 'record-payment':
        result = await recordDeliveryPayment(scope);
        break;
      case 'cancel':
        result = await cancelOrder(scope);
        break;
      default:
        return { success: false, error: 'Unknown action' };
    }

    if (!result.ok) return { success: false, error: result.error };

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: `sales.order.${action}`,
      entityType: 'Order',
      entityId: orderId,
      metadata: options.paymentCollected ? { paymentCollected: true } : undefined,
    });

    return { success: true, data: { warning: result.warning ?? null } };
  } catch (error) {
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return { success: false, error: 'You don’t have permission to update orders' };
    }
    console.error(`[orders] Could not ${action} order ${orderId}:`, error);
    return { success: false, error: 'We couldn’t update this order. Please try again.' };
  }
}
