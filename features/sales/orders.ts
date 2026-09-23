'use server';

/*
 * features/sales/orders.ts
 *
 * Orders, for the merchant — every channel.
 *
 * The storefront writes ONLINE orders (lib/storefront/orders/create.ts) and
 * the counter writes WALK_IN and PHONE ones (features/sales/counter-sale.ts);
 * this is the admin's read of the same table, scoped to the signed-in staff
 * member's organization and gated on `sales.view` like every other sales
 * screen.
 *
 * A counter sale has no delivery, no shipping address and often no contact
 * details, so those fields are nullable here. Anything that renders them
 * must say "—" rather than an empty line (AGENTS §3).
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
  /** ONLINE | WALK_IN | PHONE */
  channel: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: string;
  /** null on an anonymous counter sale, where nobody took a name */
  customerName: string | null;
  customerEmail: string | null;
  isGuest: boolean;
  itemCount: number;
  currency: string;
  totalAmount: number;
  /** null on a counter sale — nothing was shipped anywhere */
  city: string | null;
  state: string | null;
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
  customerId: string | null;
  phone: string | null;
  shipFullName: string | null;
  shipPhone: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCountry: string | null;
  shipPostalCode: string | null;
  deliveryMethodLabel: string | null;
  deliveryFee: number | null;
  /** counter sales: which store served it, and who rang it up */
  storeName: string | null;
  soldByName: string | null;
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

/** Whoever this was for, or null when nobody gave a name at the counter. */
function customerName(order: { firstName: string | null; lastName: string | null }): string | null {
  const name = `${order.firstName ?? ''} ${order.lastName ?? ''}`.trim();
  return name || null;
}

/* Values off the URL are only ever used when they name something real, so a
 * hand-edited query string narrows or does nothing — it can never widen. */
const ORDER_CHANNELS = ['ONLINE', 'WALK_IN', 'PHONE'] as const;
type OrderChannelValue = (typeof ORDER_CHANNELS)[number];
function isOrderChannel(value: string | undefined): value is OrderChannelValue {
  return ORDER_CHANNELS.includes(value as OrderChannelValue);
}

const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
type OrderStatusValue = (typeof ORDER_STATUSES)[number];
function isOrderStatus(value: string | undefined): value is OrderStatusValue {
  return ORDER_STATUSES.includes(value as OrderStatusValue);
}

export interface StoreOrderFilters {
  /** ONLINE | WALK_IN | PHONE */
  channel?: string;
  status?: string;
  /** reference, customer name, email or phone */
  q?: string;
  page?: number;
}

export interface StoreOrderList {
  rows: StoreOrderRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** orders before any filter — tells "no orders yet" from "none match" */
  historySize: number;
  /** how many of each channel exist, for the filter's counts */
  channelCounts: { channel: string; count: number }[];
}

const ORDERS_PER_PAGE = 25;

/**
 * The merchant's order list — every channel, filtered and paged by the
 * database.
 *
 * It used to take the newest 200 and let the browser filter them, which
 * quietly stopped being the whole truth at order 201 and put every
 * customer's email into the page source. Filters now live in the URL and
 * become `where` clauses (AGENTS §3).
 */
export async function listStoreOrders(filters: StoreOrderFilters = {}): Promise<ActionResult<StoreOrderList>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;

    /* Unpaid online orders past their hold are cancelled before the list is
     * read, so the merchant never sees stock held by an abandoned checkout. */
    await expireUnpaidOrders({ organizationId, limit: 20 }).catch((error) => {
      console.error('[orders] Could not expire unpaid orders:', error);
    });

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const q = filters.q?.trim();

    const where = {
      organizationId,
      ...(isOrderChannel(filters.channel) ? { channel: filters.channel } : {}),
      ...(isOrderStatus(filters.status) ? { status: filters.status } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' as const } },
              { firstName: { contains: q, mode: 'insensitive' as const } },
              { lastName: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [orders, total, historySize, grouped] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * ORDERS_PER_PAGE,
        take: ORDERS_PER_PAGE,
        select: {
          id: true,
          reference: true,
          channel: true,
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
      }),
      prisma.order.count({ where }),
      prisma.order.count({ where: { organizationId } }),
      prisma.order.groupBy({ by: ['channel'], where: { organizationId }, _count: { _all: true } }),
    ]);

    return {
      success: true,
      data: {
        rows: orders.map((order) => ({
          id: order.id,
          reference: order.reference,
          channel: order.channel,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          placedAt: order.placedAt.toISOString(),
          customerName: customerName(order),
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
        total,
        page,
        perPage: ORDERS_PER_PAGE,
        pageCount: Math.max(1, Math.ceil(total / ORDERS_PER_PAGE)),
        historySize,
        channelCounts: grouped.map((g) => ({ channel: g.channel, count: g._count._all })),
      },
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
        // Counter sales: which store served it, and who rang it up.
        warehouse: { select: { name: true } },
        soldBy: { select: { name: true, email: true } },
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
        customerName: customerName(order),
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
        deliveryFee: order.deliveryFee === null ? null : Number(order.deliveryFee),
        channel: order.channel,
        storeName: order.warehouse?.name ?? null,
        soldByName: order.soldBy?.name ?? order.soldBy?.email ?? null,
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
