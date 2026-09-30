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
import { ONLINE_PAYMENT_METHODS, reconcileOpenAttempts, reviveTimedOutOrder } from '../checkout/payment-service';
import { TRANSFER_HOLD_HOURS, UNPAID_ORDER_HOLD_MINUTES } from './holds';
import { dispatchOrderStock, releaseOrderStock, type DispatchedStock } from './stock';
import { markShipmentsCancelled, markShipmentsDelivered, markShipmentsDispatched } from './shipments';
import { cancelRequestedTransfers, requestGatheringTransfers, waitingOn } from './gather';
import { releaseDiscountUse } from '../discounts/usage';
import { notifyMerchant, notifyShopper } from './notifications';
import { CUSTOMER_CANCELLABLE_STATUSES } from './policy';

export { UNPAID_ORDER_HOLD_MINUTES } from './holds';

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
    select: { id: true, status: true, paymentStatus: true, paymentMethod: true, channel: true, discountCodeId: true },
  });
}

/* ---------------- unpaid online orders ---------------- */

/**
 * Cancel orders nobody paid for within their hold window, and put their stock
 * back on sale:
 *   - online orders after UNPAID_ORDER_HOLD_MINUTES — each checked with
 *     Paystack first, so a payment that went through unheard settles instead
 *     (a Squad-era one can no longer be checked, and simply expires);
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
        {
          // Paystack, and any Squad-era order still waiting (ROADMAP 10.9).
          paymentMethod: { in: [...ONLINE_PAYMENT_METHODS] },
          paymentStatus: 'AWAITING_PAYMENT',
          placedAt: { lt: onlineCutoff },
        },
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
      await markShipmentsCancelled(tx, id);
      await cancelRequestedTransfers(tx, id);
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
  if (!claimed.count) return CHANGED;
  // Ask other stores for anything being brought together (Phase 9.7). Idempotent, so safe outside a transaction.
  await requestGatheringTransfers(prisma, order.id);
  return { ok: true };
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
  const waiting = await waitingOn(prisma, { orderId: order.id });
  if (waiting.length) return stillGathering(waiting);

  let moved: DispatchedStock[] = [];
  const shipped = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: { in: ['CONFIRMED', 'PROCESSING'] } },
      data: { status: 'SHIPPED', shippedAt: now },
    });
    if (claimed.count === 0) return false;
    // Until parcels are sent one by one (Phase 9.6), they all leave with the order.
    await markShipmentsDispatched(tx, order.id, now);
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

  const delivered = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: 'SHIPPED' },
      data: {
        status: 'DELIVERED',
        deliveredAt: now,
        ...(collect ? { paymentStatus: 'PAID' as const, paidAt: now } : {}),
      },
    });
    if (!claimed.count) return false;
    await markShipmentsDelivered(tx, order.id, now);
    return true;
  });
  if (!delivered) return CHANGED;

  await notifyShopper(order.id, 'delivered');
  return { ok: true };
}

/* ---------------- one parcel at a time (ROADMAP Phase 9.6) ---------------- */

type ShipmentScope = Scope & { shipmentId: string };

async function loadShipment(scope: ShipmentScope) {
  return prisma.orderShipment.findFirst({
    where: { id: scope.shipmentId, orderId: scope.orderId, organizationId: scope.organizationId },
    select: { id: true, status: true, warehouseId: true },
  });
}

/**
 * One store sends its parcel. Only that parcel's stock leaves the shelf.
 * The first parcel out moves a confirmed order into packing; the last one
 * out marks the whole order shipped, and that is when the shopper is told —
 * until then the order reads "Partially sent" on the merchant's side.
 */
export async function sendShipment(
  scope: ShipmentScope & { organizationSlug: string; performedById: string | null; trackingNote?: string | null },
): Promise<TransitionResult> {
  const [order, shipment] = await Promise.all([load(scope), loadShipment(scope)]);
  if (!order || !shipment) return NOT_FOUND;
  if (!['CONFIRMED', 'PROCESSING'].includes(order.status)) {
    return {
      ok: false,
      error: order.status === 'PENDING' ? 'Confirm the order before sending any of it.' : 'This order can’t be sent now.',
    };
  }
  if (order.paymentStatus !== 'PAID' && order.paymentStatus !== 'DUE_ON_DELIVERY') {
    return { ok: false, error: 'This order hasn’t been paid for yet.' };
  }
  if (shipment.status !== 'PENDING') return { ok: false, error: 'This parcel has already been sent.' };
  const waiting = await waitingOn(prisma, { orderId: order.id, shipmentId: shipment.id });
  if (waiting.length) return stillGathering(waiting);

  let moved: DispatchedStock[] = [];
  let allSent = false;
  const sent = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.orderShipment.updateMany({
      where: { id: shipment.id, status: 'PENDING' },
      data: { status: 'DISPATCHED', dispatchedAt: now, trackingNote: scope.trackingNote?.trim().slice(0, 200) || null },
    });
    if (claimed.count === 0) return false;

    moved = await dispatchOrderStock(tx, {
      organizationId: scope.organizationId,
      orderId: order.id,
      performedById: scope.performedById,
      shipmentId: shipment.id,
    });

    const waiting = await tx.orderShipment.count({ where: { orderId: order.id, status: 'PENDING' } });
    allSent = waiting === 0;
    await tx.order.updateMany({
      where: { id: order.id, status: { in: ['CONFIRMED', 'PROCESSING'] } },
      data: allSent
        ? { status: 'SHIPPED', shippedAt: now }
        : order.status === 'CONFIRMED'
          ? { status: 'PROCESSING', packingAt: now }
          : {},
    });
    return true;
  });
  if (!sent) return CHANGED;

  await alertLowStock(scope, moved);
  if (allSent) await notifyShopper(order.id, 'shipped');
  return { ok: true };
}

/**
 * One parcel arrived. The last one to arrive marks the order delivered —
 * and for pay on delivery, `paymentCollected` then records the money, which
 * by that point every courier has handed over.
 */
export async function deliverShipment(scope: ShipmentScope & { paymentCollected?: boolean }): Promise<TransitionResult> {
  const [order, shipment] = await Promise.all([load(scope), loadShipment(scope)]);
  if (!order || !shipment) return NOT_FOUND;
  if (shipment.status !== 'DISPATCHED') {
    return { ok: false, error: shipment.status === 'DELIVERED' ? 'This parcel has already arrived.' : 'Send this parcel first.' };
  }

  let allDelivered = false;
  const done = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.orderShipment.updateMany({
      where: { id: shipment.id, status: 'DISPATCHED' },
      data: { status: 'DELIVERED', deliveredAt: now },
    });
    if (claimed.count === 0) return false;

    const outstanding = await tx.orderShipment.count({
      where: { orderId: order.id, status: { in: ['PENDING', 'DISPATCHED'] } },
    });
    allDelivered = outstanding === 0;
    if (allDelivered) {
      const collect = Boolean(scope.paymentCollected) && order.paymentStatus === 'DUE_ON_DELIVERY';
      await tx.order.updateMany({
        where: { id: order.id, status: 'SHIPPED' },
        data: { status: 'DELIVERED', deliveredAt: now, ...(collect ? { paymentStatus: 'PAID' as const, paidAt: now } : {}) },
      });
    }
    return true;
  });
  if (!done) return CHANGED;

  if (allDelivered) await notifyShopper(order.id, 'delivered');
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
  // Confirmed now: ask other stores for anything being brought together (Phase 9.7).
  if (order.status === 'PENDING') await requestGatheringTransfers(prisma, order.id);

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
/**
 * The money arrived in person: the courier collected it on delivery, or a
 * counter customer who was "paying later" came back and settled up.
 *
 * Both are the same act — cash handed over, away from any gateway — so they
 * are the same transition. An order still waiting on an ONLINE payment is
 * deliberately not included: that one is settled by verifying with the
 * provider (../checkout/payment-service.ts), never by a button.
 */
export async function recordDeliveryPayment(scope: Scope): Promise<TransitionResult> {
  const order = await load(scope);
  if (!order) return NOT_FOUND;

  const payableInPerson =
    order.paymentStatus === 'DUE_ON_DELIVERY' ||
    (order.paymentStatus === 'AWAITING_PAYMENT' && order.channel !== 'ONLINE');

  if (!payableInPerson) {
    return { ok: false, error: 'This order isn’t one that gets paid in person.' };
  }
  if (order.status === 'CANCELLED') return { ok: false, error: 'This order was cancelled.' };

  const claimed = await prisma.order.updateMany({
    where: {
      id: order.id,
      paymentStatus: order.paymentStatus,
      status: { not: 'CANCELLED' },
    },
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
    await markShipmentsCancelled(tx, order.id);
    await cancelRequestedTransfers(tx, order.id);
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

  /* A parcel already on its way can't be called back by cancelling the order
   * (Phase 9.6) — that stock has left the shelf. */
  if (await anyParcelSent(order.id)) {
    return {
      ok: false,
      error: 'Part of this order has already been sent, so it can’t be cancelled. Send the rest, or take the parcel back as a return.',
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

/** The parcel's store is still waiting for items from others (Phase 9.7). */
function stillGathering(stores: string[]): TransitionResult {
  return {
    ok: false,
    error: `Still waiting for items from ${stores.join(', ')} to arrive. Receive the transfer first, then send the parcel.`,
  };
}

async function anyParcelSent(orderId: string): Promise<boolean> {
  return (await prisma.orderShipment.count({ where: { orderId, status: { in: ['DISPATCHED', 'DELIVERED'] } } })) > 0;
}

/**
 * Tell whoever restocks that a shelf just went below its reorder point.
 * Exported because a counter sale takes stock out too
 * (features/sales/counter-sale.ts) and the rule should be written once.
 */
export async function alertLowStock(scope: { organizationId: string; organizationSlug: string }, moved: DispatchedStock[]) {
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
        warehouseId: entry.warehouseId,
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
