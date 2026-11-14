/*
 * lib/storefront/orders/arranged.ts
 *
 * "Delivery to be arranged" for big trade orders (ROADMAP 21.4B), after the
 * order is placed. Server only; no permission checks — the admin action
 * checks `sales.fulfillment.manage`, and the buyer's action finds the order
 * by its confirmation token.
 *
 *   placed ── store prices it ──▶ priced ── buyer accepts ──▶ an ordinary order
 *     │        (may re-price)       │                         (pay online / by
 *     │                             │                          transfer / on delivery)
 *     └─ not priced in time ─┐      └─ not accepted in time ─┐
 *                            ▼                               ▼
 *                     cancelled, stock released, buyer told why
 *
 * The order's payment status stays AWAITING_DELIVERY_PRICE until the buyer
 * accepts, so nothing can be paid, confirmed or shipped before (payment
 * starts only from AWAITING_PAYMENT; confirming refuses this status;
 * shipping needs PAID or DUE_ON_DELIVERY). The buyer can cancel at no cost
 * any time before — the usual self-service cancel.
 *
 * Every move is a conditional update on where the order is, so a store
 * pricing it twice, or a buyer accepting as the deadline passes, settles
 * once.
 */
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { ARRANGED_ACCEPT_HOURS } from './holds';
import { notifyMerchant, notifyShopper, notifyStoreOfOrder } from './notifications';

export type ArrangedResult = { ok: true } | { ok: false; error: string };

/** The most a store can charge for one arranged delivery — a sanity bound, not a policy. */
export const MAX_ARRANGED_FEE = 10_000_000;
const NOTE_MAX = 200;

const WAITING = { status: 'PENDING', paymentStatus: 'AWAITING_DELIVERY_PRICE', deliveryArranged: true, deliveryAcceptedAt: null } as const;

/**
 * The store sets (or changes, before the buyer accepts) the delivery fee —
 * major units — with an optional word on how it's going. The order's total
 * becomes the goods plus this fee; the buyer is told, and has
 * ARRANGED_ACCEPT_HOURS to accept it.
 */
export async function priceArrangedDelivery(input: {
  organizationId: string;
  orderId: string;
  fee: number;
  note?: string | null;
  userId: string | null;
}): Promise<ArrangedResult> {
  if (!Number.isFinite(input.fee) || input.fee < 0 || input.fee > MAX_ARRANGED_FEE) {
    return { ok: false, error: 'Enter the delivery cost, in naira.' };
  }
  const fee = new Prisma.Decimal(input.fee.toFixed(2));
  const note = (input.note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) || null;

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId, ...WAITING },
    select: { id: true, totalAmount: true, deliveryFee: true, deliveryPricedAt: true },
  });
  if (!order) {
    return { ok: false, error: 'This order isn’t waiting for a delivery price any more. Refresh the page to see where it is.' };
  }

  const now = new Date();
  const previous = order.deliveryFee ?? new Prisma.Decimal(0);
  const total = new Prisma.Decimal(order.totalAmount).minus(previous).plus(fee);

  const priced = await prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      // The total it was read with — a second price set meanwhile wins, and this one retries.
      where: { id: order.id, ...WAITING, totalAmount: order.totalAmount },
      data: {
        deliveryFee: fee,
        totalAmount: total,
        deliveryPricedAt: now,
        deliveryArrangedNote: note,
        deliveryAcceptBy: new Date(now.getTime() + ARRANGED_ACCEPT_HOURS * 3_600_000),
      },
    });
    if (!claimed.count) return false;
    // One parcel (arranged delivery is never split): it carries the fee too.
    await tx.orderShipment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { fee } });
    return true;
  });
  if (!priced) return { ok: false, error: 'This order changed while you were looking at it. Refresh the page and try again.' };

  await createAuditLog({
    organizationId: input.organizationId,
    userId: input.userId,
    action: order.deliveryPricedAt ? 'order.delivery_price.changed' : 'order.delivery_price.set',
    entityType: 'Order',
    entityId: order.id,
    metadata: { before: order.deliveryPricedAt ? Number(previous) : null, after: Number(fee), note },
  });
  await notifyShopper(order.id, 'delivery-priced');
  return { ok: true };
}

export type AcceptResult =
  | { ok: true; orderId: string; organizationId: string; paymentMethod: string }
  | { ok: false; error: string };

/**
 * The buyer accepts the store's delivery price. From here it's an ordinary
 * order, paid the way they chose when ordering: online (they're sent to pay
 * now), by transfer (the transfer window starts now) or on delivery (the
 * store confirms it). Found by the order's confirmation token, scoped to the
 * store.
 */
export async function acceptArrangedDelivery(input: { organizationId: string; confirmationToken: string }): Promise<AcceptResult> {
  const token = input.confirmationToken.trim();
  if (!token) return { ok: false, error: 'We couldn’t find that order.' };
  const order = await prisma.order.findFirst({
    where: { organizationId: input.organizationId, confirmationToken: token, channel: 'ONLINE' },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      deliveryArranged: true,
      deliveryPricedAt: true,
      deliveryAcceptedAt: true,
      deliveryAcceptBy: true,
    },
  });
  if (!order || !order.deliveryArranged) return { ok: false, error: 'We couldn’t find that order.' };
  if (order.deliveryAcceptedAt) return { ok: true, orderId: order.id, organizationId: input.organizationId, paymentMethod: order.paymentMethod };
  if (order.status !== 'PENDING' || order.paymentStatus !== 'AWAITING_DELIVERY_PRICE') {
    return { ok: false, error: 'This order can’t be changed any more.' };
  }
  if (!order.deliveryPricedAt) return { ok: false, error: 'The store hasn’t sent a delivery price yet.' };

  const now = new Date();
  if (order.deliveryAcceptBy && order.deliveryAcceptBy < now) {
    return { ok: false, error: 'The time to accept this delivery price has passed, so the order is being cancelled.' };
  }

  const next =
    order.paymentMethod === 'transfer' ? 'AWAITING_TRANSFER' : order.paymentMethod === 'pod' ? 'DUE_ON_DELIVERY' : 'AWAITING_PAYMENT';
  const claimed = await prisma.order.updateMany({
    where: {
      id: order.id,
      ...WAITING,
      deliveryPricedAt: order.deliveryPricedAt,
      ...(order.deliveryAcceptBy ? { deliveryAcceptBy: { gte: now } } : {}),
    },
    data: { paymentStatus: next, deliveryAcceptedAt: now },
  });
  if (!claimed.count) return { ok: false, error: 'This order changed — the store may have just updated the price. Refresh the page to see it.' };

  /* What happens next is what happens after any order with this method: a
   * transfer gets its instructions and the store looks out for the money; an
   * order paid on delivery goes to the store to confirm. An online payment
   * tells the store when it's paid (payment-service.ts). */
  if (next === 'AWAITING_TRANSFER') {
    await notifyShopper(order.id, 'placed-bank-transfer');
    await notifyStoreOfOrder(order.id, 'transfer');
  } else if (next === 'DUE_ON_DELIVERY') {
    await notifyStoreOfOrder(order.id, 'on-delivery');
  }
  return { ok: true, orderId: order.id, organizationId: input.organizationId, paymentMethod: order.paymentMethod };
}

export const DELIVERY_NOT_PRICED = 'delivery-not-priced';
export const DELIVERY_NOT_ACCEPTED = 'delivery-not-accepted';

/** Ask the store, once, when its pricing deadline is near. */
export async function remindArrangedPricing(store: { organizationId?: string }, reminderHours: number): Promise<number> {
  const now = new Date();
  const due = await prisma.order.findMany({
    where: {
      ...store,
      ...WAITING,
      deliveryPricedAt: null,
      deliveryPriceRemindedAt: null,
      deliveryPriceDueAt: { gt: now, lte: new Date(now.getTime() + reminderHours * 3_600_000) },
    },
    select: { id: true },
    take: 50,
  });
  let sent = 0;
  for (const { id } of due) {
    const claimed = await prisma.order.updateMany({ where: { id, deliveryPriceRemindedAt: null }, data: { deliveryPriceRemindedAt: now } });
    if (!claimed.count) continue;
    await notifyMerchant(id, 'delivery-price-reminder');
    sent += 1;
  }
  return sent;
}
