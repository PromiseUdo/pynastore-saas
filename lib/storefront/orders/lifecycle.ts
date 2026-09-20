/*
 * lib/storefront/orders/lifecycle.ts
 *
 * Moving an online order along, and what each move does to stock, payment
 * and the shopper's inbox. Server only; no permission checks here — the
 * admin actions in features/sales/orders.ts check `sales.fulfillment.manage`
 * and then call these.
 *
 *   PENDING ─confirm─▶ CONFIRMED ─pack─▶ PROCESSING ─ship─▶ SHIPPED ─deliver─▶ DELIVERED
 *      │                  │                  │
 *      └──────────────────┴──────cancel──────┘  (stock goes back; not once shipped)
 *
 * The merchant can cancel up to shipping; the shopper can cancel their own
 * order up to packing (./policy.ts). Money a cancelled order had taken is
 * given back by hand and recorded in ./returns.ts — the app moves no money.
 *
 * Packing is optional: a confirmed order can ship straight away. Each move
 * stamps its time (confirmedAt, packingAt, shippedAt, deliveredAt) for the
 * progress track.
 *
 * PAYMENT GATES SHIPPING. An order paid online is confirmed by the payment
 * itself (payment-service.ts). A bank-transfer order is confirmed when the
 * merchant says the transfer reached their bank (confirmTransferReceived). A
 * pay-on-delivery order is confirmed by the merchant and paid when the
 * courier collects. Nothing lets an order still waiting for an online payment
 * or a transfer be confirmed or shipped.
 *
 * STOCK: held when the order is placed (./stock.ts), turned into a real
 * stock-out when it ships, given back when it's cancelled — or when an online
 * payment never arrives (expireUnpaidOrders).
 *
 * Every transition is a conditional update on the current status, so two
 * staff members pressing buttons at once can't ship an order twice.
 */
import { prisma } from '@/lib/prisma';
import { maybeSendLowStockAlert } from '@/features/inventory/shared';
import { reconcileOpenAttempts, reviveTimedOutOrder, SQUAD_PROVIDER } from '../checkout/payment-service';
import { TRANSFER_HOLD_HOURS } from '../mock/checkout';
import { dispatchOrderStock, releaseOrderStock, type DispatchedStock } from './stock';
import { releaseDiscountUse } from '../discounts/usage';
import { notifyMerchant, notifyShopper } from './notifications';
import { CUSTOMER_CANCELLABLE_STATUSES } from './policy';

/** How long an unpaid online-payment order holds its stock. */
export const UNPAID_ORDER_HOLD_MINUTES = 60;

export const PAYMENT_TIMEOUT = 'payment-timeout';
export const CANCELLED_BY_MERCHANT = 'merchant';
export const CANCELLED_BY_CUSTOMER = 'customer';

export type TransitionResult =
  /** `warning`: it worked, but the merchant must do something about it */
  | { ok: true; warning?: string }
  | { ok: false; error: string };

const NOT_FOUND: TransitionResult = { ok: false, error: 'Order not found' };
const CHANGED: TransitionResult = {
  ok: false,
  error: 'This order changed while you were looking at it. Refresh the page and try again.',
};

type Scope = { organizationId: string; orderId: string };

async function load(scope: Scope) {
  return prisma.order.findFirst({
    where: { id: scope.orderId, organizationId: scope.organizationId },
    select: { id: true, status: true, paymentStatus: true, paymentMethod: true, discountCodeId: true },
  });
}

/* ---------------- unpaid online orders ---------------- */

/**
 * Cancel orders nobody paid for within their hold window, and put their stock
 * back on sale:
 *   - online (Squad) orders after UNPAID_ORDER_HOLD_MINUTES — each checked
 *     with Squad first, so a payment that went through unheard settles instead;
 *   - bank-transfer orders after TRANSFER_HOLD_HOURS, which the shopper was
 *     told when they ordered. A transfer that arrives later can still be
 *     confirmed by the merchant; the order comes back if the stock is there.
 *
 * Runs lazily (before a new order in the same store, and when the merchant
 * opens their orders) and from /api/cron/expire-unpaid-orders for stores
 * that are quiet. Idempotent and safe to run concurrently.
 */
export async function expireUnpaidOrders(options: { organizationId?: string; limit?: number } = {}) {
  const store = options.organizationId ? { organizationId: options.organizationId } : {};
  const onlineCutoff = new Date(Date.now() - UNPAID_ORDER_HOLD_MINUTES * 60_000);
  const transferCutoff = new Date(Date.now() - TRANSFER_HOLD_HOURS * 3_600_000);

  const stale = await prisma.order.findMany({
    where: {
      ...store,
      status: 'PENDING',
      OR: [
        { paymentMethod: SQUAD_PROVIDER, paymentStatus: 'AWAITING_PAYMENT', placedAt: { lt: onlineCutoff } },
        { paymentMethod: 'transfer', paymentStatus: 'AWAITING_TRANSFER', placedAt: { lt: transferCutoff } },
      ],
    },
    select: { id: true, paymentStatus: true, discountCodeId: true },
    orderBy: { placedAt: 'asc' },
    take: options.limit ?? 50,
  });

  let expired = 0;

  for (const { id, paymentStatus, discountCodeId } of stale) {
    if (paymentStatus === 'AWAITING_PAYMENT') {
      await reconcileOpenAttempts(id).catch((error) => {
        console.error(`[orders] Could not re-check payment for ${id} before expiring it:`, error);
      });
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, status: 'PENDING', paymentStatus },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: PAYMENT_TIMEOUT },
      });
      if (claimed.count === 0) return false;
      await releaseOrderStock(tx, id);
      await releaseDiscountUse(tx, discountCodeId);
      return true;
    });

    if (cancelled) {
      expired += 1;
      await notifyShopper(id, 'payment-timeout');
    }
  }

  return { checked: stale.length, expired };
}

/* ---------------- the merchant's moves ---------------- */

/** A pay-on-delivery order, accepted by the merchant. */
export async function confirmOrder(scope: Scope): Promise<TransitionResult> {
  const order = await load(scope);
  if (!order) return NOT_FOUND;
  if (order.status !== 'PENDING') return { ok: false, error: 'Only a new order can be confirmed.' };
  if (order.paymentStatus === 'AWAITING_PAYMENT') {
    return { ok: false, error: 'This order is waiting for the customer’s online payment. It confirms itself once they pay.' };
  }
  if (order.paymentStatus === 'AWAITING_TRANSFER') {
    return { ok: false, error: 'Check your bank first — confirm the transfer once it has arrived.' };
  }

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });
  return claimed.count ? { ok: true } : CHANGED;
}

/** The merchant has started packing. No email — the next one says it's on its way. */
export async function startPacking(scope: Scope): Promise<TransitionResult> {
  const order = await load(scope);
  if (!order) return NOT_FOUND;
  if (order.status !== 'CONFIRMED') {
    return { ok: false, error: order.status === 'PENDING' ? 'Confirm the order before packing it.' : 'Only a confirmed order can move to packing.' };
  }

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: 'CONFIRMED' },
    data: { status: 'PROCESSING', packingAt: new Date() },
  });
  return claimed.count ? { ok: true } : CHANGED;
}

export async function markOrderShipped(
  scope: Scope & { organizationSlug: string; performedById: string | null },
): Promise<TransitionResult> {
  const order = await load(scope);
  if (!order) return NOT_FOUND;
  if (order.status !== 'CONFIRMED' && order.status !== 'PROCESSING') {
    return { ok: false, error: 'Confirm the order before marking it as shipped.' };
  }
  if (order.paymentStatus !== 'PAID' && order.paymentStatus !== 'DUE_ON_DELIVERY') {
    return { ok: false, error: 'This order hasn’t been paid for yet.' };
  }

  let moved: DispatchedStock[] = [];
  const shipped = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: { in: ['CONFIRMED', 'PROCESSING'] } },
      data: { status: 'SHIPPED', shippedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    moved = await dispatchOrderStock(tx, {
      organizationId: scope.organizationId,
      orderId: order.id,
      performedById: scope.performedById,
    });
    return true;
  });
  if (!shipped) return CHANGED;

  await alertLowStock(scope, moved);
  await notifyShopper(order.id, 'shipped');
  return { ok: true };
}

/**
 * The courier handed it over. For pay on delivery, `paymentCollected` records
 * the money in the same step — the usual case — so the merchant isn't made to
 * press two buttons for one event.
 */
export async function markOrderDelivered(
  scope: Scope & { paymentCollected?: boolean },
): Promise<TransitionResult> {
  const order = await load(scope);
  if (!order) return NOT_FOUND;
  if (order.status !== 'SHIPPED') return { ok: false, error: 'Only a shipped order can be marked as delivered.' };

  const collect = Boolean(scope.paymentCollected) && order.paymentStatus === 'DUE_ON_DELIVERY';

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: 'SHIPPED' },
    data: {
      status: 'DELIVERED',
      deliveredAt: new Date(),
      ...(collect ? { paymentStatus: 'PAID' as const, paidAt: new Date() } : {}),
    },
  });
  if (!claimed.count) return CHANGED;

  await notifyShopper(order.id, 'delivered');
  return { ok: true };
}

/**
 * Bank transfer: the merchant has seen the money arrive in their account.
 * That both pays and confirms the order. If the order had already been
 * cancelled for not being paid in time, it comes back when its stock can still
 * be held; otherwise the payment is recorded against the cancelled order and
 * the merchant is told to refund it.
 */
export async function confirmTransferReceived(scope: Scope): Promise<TransitionResult> {
  const order = await prisma.order.findFirst({
    where: { id: scope.orderId, organizationId: scope.organizationId },
    select: { id: true, status: true, paymentStatus: true, cancelReason: true },
  });
  if (!order) return NOT_FOUND;
  if (order.paymentStatus !== 'AWAITING_TRANSFER') {
    return { ok: false, error: 'This order isn’t waiting for a bank transfer.' };
  }

  const timedOut = order.status === 'CANCELLED' && order.cancelReason === PAYMENT_TIMEOUT;
  if (order.status !== 'PENDING' && !timedOut) {
    return { ok: false, error: 'This order was cancelled, so there is no transfer to confirm.' };
  }

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: 'AWAITING_TRANSFER', status: order.status },
    data: {
      paymentStatus: 'PAID',
      paidAt: new Date(),
      ...(order.status === 'PENDING' ? { status: 'CONFIRMED' as const, confirmedAt: new Date() } : {}),
    },
  });
  if (!claimed.count) return CHANGED;

  if (!timedOut) {
    await notifyShopper(order.id, 'payment-received');
    return { ok: true };
  }

  const revived = await reviveTimedOutOrder(order.id);
  await notifyShopper(order.id, revived ? 'payment-received' : 'cancelled');
  return revived
    ? { ok: true }
    : {
        ok: true,
        warning:
          'Payment recorded, but this order had already expired and its items have since sold. Refund the customer from your bank account.',
      };
}

/** Pay on delivery: the money arrived. */
export async function recordDeliveryPayment(scope: Scope): Promise<TransitionResult> {
  const order = await load(scope);
  if (!order) return NOT_FOUND;
  if (order.paymentStatus !== 'DUE_ON_DELIVERY') {
    return { ok: false, error: 'Only a pay-on-delivery order can be marked as paid here.' };
  }
  if (order.status === 'CANCELLED') return { ok: false, error: 'This order was cancelled.' };

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: 'DUE_ON_DELIVERY', status: { not: 'CANCELLED' } },
    data: { paymentStatus: 'PAID', paidAt: new Date() },
  });
  return claimed.count ? { ok: true } : CHANGED;
}

const MERCHANT_CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING'] as const;

/** Stock back, discount use back, one conditional update — whoever is cancelling. */
async function cancel(
  order: { id: string; discountCodeId: string | null },
  allowed: readonly ('PENDING' | 'CONFIRMED' | 'PROCESSING')[],
  reason: string,
  note: string | null,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: { in: [...allowed] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, cancelNote: note },
    });
    if (claimed.count === 0) return false;
    await releaseOrderStock(tx, order.id);
    await releaseDiscountUse(tx, order.discountCodeId);
    return true;
  });
}

export async function cancelOrder(scope: Scope): Promise<TransitionResult> {
  const order = await load(scope);
  if (!order) return NOT_FOUND;
  if (!(MERCHANT_CANCELLABLE_STATUSES as readonly string[]).includes(order.status)) {
    return {
      ok: false,
      error:
        order.status === 'CANCELLED'
          ? 'This order is already cancelled.'
          : 'This order has already been sent, so it can’t be cancelled.',
    };
  }

  if (!(await cancel(order, MERCHANT_CANCELLABLE_STATUSES, CANCELLED_BY_MERCHANT, null))) return CHANGED;

  await notifyShopper(order.id, 'cancelled');
  return { ok: true };
}

/**
 * The shopper cancels their own order, before the store starts packing it.
 *
 * The order is found WITH the customer's id, so the reference alone is no
 * use to anyone else. A paid order stays PAID: the store now owes the money
 * back, and the merchant's order page says so until they record the refund.
 */
export async function cancelOrderForCustomer(input: {
  organizationId: string;
  customerId: string;
  reference: string;
  note?: string | null;
}): Promise<TransitionResult> {
  const order = await prisma.order.findFirst({
    where: { organizationId: input.organizationId, customerId: input.customerId, reference: input.reference.trim() },
    select: { id: true, status: true, discountCodeId: true },
  });
  if (!order) return NOT_FOUND;
  if (!(CUSTOMER_CANCELLABLE_STATUSES as readonly string[]).includes(order.status)) {
    return {
      ok: false,
      error:
        order.status === 'CANCELLED'
          ? 'This order is already cancelled.'
          : 'The store has already started packing this order, so it can’t be cancelled here.',
    };
  }

  const note = input.note?.trim().slice(0, 500) || null;
  if (!(await cancel(order, CUSTOMER_CANCELLABLE_STATUSES, CANCELLED_BY_CUSTOMER, note))) {
    return {
      ok: false,
      error: 'The store has just started on this order, so it can’t be cancelled here. Refresh the page to see where it is.',
    };
  }

  await notifyShopper(order.id, 'cancelled-by-you');
  await notifyMerchant(order.id, 'customer-cancelled');
  return { ok: true };
}

/* ---------------- helpers ---------------- */

async function alertLowStock(scope: { organizationId: string; organizationSlug: string }, moved: DispatchedStock[]) {
  for (const entry of moved) {
    try {
      const [item, level] = await Promise.all([
        prisma.inventoryItem.findUnique({
          where: { id: entry.inventoryItemId },
          select: { name: true, sku: true, reorderPoint: true },
        }),
        prisma.inventoryLevel.findUnique({
          where: {
            inventoryItemId_warehouseId: { inventoryItemId: entry.inventoryItemId, warehouseId: entry.warehouseId },
          },
          select: { reorderPoint: true, warehouse: { select: { name: true } } },
        }),
      ]);
      if (!item || !level) continue;

      const threshold = level.reorderPoint ?? item.reorderPoint;
      await maybeSendLowStockAlert({
        organizationId: scope.organizationId,
        organizationSlug: scope.organizationSlug,
        itemName: item.name,
        itemSku: item.sku,
        warehouseName: level.warehouse.name,
        previousQty: entry.previousQty,
        newQty: entry.newQty,
        threshold: threshold === null ? null : Number(threshold),
      });
    } catch (error) {
      console.error('[orders] Low-stock check failed after shipping:', error);
    }
  }
}
