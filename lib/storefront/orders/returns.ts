/*
 * lib/storefront/orders/returns.ts
 *
 * Sending items back, and giving money back. Server only; no permission
 * checks — the shopper's actions (features/shop-orders/aftercare.ts) prove
 * who they are with the session, the merchant's (features/sales/order-returns.ts)
 * check `sales.return.manage`, and both then call these.
 *
 *   shopper asks ─▶ REQUESTED ─approve─▶ APPROVED ─refund─▶ REFUNDED
 *                      │  │                  │
 *                      │  └──────reject──────┴──▶ REJECTED (with a reason they see)
 *                      └──withdraw (shopper)──▶ WITHDRAWN
 *
 * A return can be refunded straight from REQUESTED — a broken item the store
 * doesn't want back needs no approval step first.
 *
 * MONEY: the app moves none. There is no refund API; the merchant sends the
 * money (Squad dashboard, bank transfer) and records it here, and the
 * shopper is told it was sent. An OrderRefund row is that record, and the
 * order's payment status follows the sum (./policy.ts).
 *
 * RACES: every write locks the order row first, so two requests can't both
 * claim the last unit of a line and two refunds can't both take the last naira.
 */
import { prisma } from '@/lib/prisma';
import { formatMoney } from '../format';
import { notifyMerchant, notifyShopper } from './notifications';
import {
  countsAgainstReturnable,
  isReturnReason,
  paymentStatusAfterRefund,
  refundableAmount,
  returnEligibility,
  validateReturnLines,
  type ReturnLineRequest,
} from './policy';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type ReturnResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const NOT_FOUND = { ok: false as const, error: 'We couldn’t find that return.' };
const CHANGED = {
  ok: false as const,
  error: 'This return changed while you were looking at it. Refresh the page and try again.',
};

/** Hold the order row until the transaction ends. */
async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE`;
}

const INELIGIBLE: Record<'no-returns' | 'not-delivered' | 'window-closed' | 'nothing-left', string> = {
  'no-returns': 'This store doesn’t take returns through the website.',
  'not-delivered': 'You can ask to return items once your order has been delivered.',
  'window-closed': 'The time to ask for a return on this order has passed.',
  'nothing-left': 'Everything on this order is already in a return.',
};

/** Units of each line already in a return that counts. */
async function returnedByLine(tx: Tx, orderId: string): Promise<Map<string, number>> {
  const lines = await tx.orderReturnLine.findMany({
    where: { orderReturn: { orderId } },
    select: { orderLineItemId: true, quantity: true, orderReturn: { select: { status: true } } },
  });
  const returned = new Map<string, number>();
  for (const line of lines) {
    if (!countsAgainstReturnable(line.orderReturn.status)) continue;
    returned.set(line.orderLineItemId, (returned.get(line.orderLineItemId) ?? 0) + line.quantity);
  }
  return returned;
}

/* ---------------- the shopper ---------------- */

/**
 * Ask to send items back. Everything is decided again here — the store's
 * window as it is now, the delivery date, what's left of each line — so a
 * doctored form can at most ask for something the shopper could have asked for.
 */
export async function requestReturn(input: {
  organizationId: string;
  customerId: string;
  reference: string;
  lines: ReturnLineRequest[];
  reason: string;
  details?: string | null;
  now?: Date;
}): Promise<ReturnResult<{ id: string }>> {
  if (!isReturnReason(input.reason)) return { ok: false, error: 'Choose why you’re sending it back.' };
  const details = input.details?.trim().slice(0, 1000) || null;
  if (input.reason === 'other' && !details) {
    return { ok: false, error: 'Tell the store a little about why you’re sending it back.' };
  }

  const order = await prisma.order.findFirst({
    where: { organizationId: input.organizationId, customerId: input.customerId, reference: input.reference.trim() },
    select: {
      id: true,
      status: true,
      deliveredAt: true,
      organization: { select: { returnWindowDays: true } },
      lineItems: { select: { id: true, quantity: true } },
    },
  });
  if (!order) return { ok: false, error: 'We couldn’t find that order.' };

  const created = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, order.id);
    const returned = await returnedByLine(tx, order.id);

    const eligibility = returnEligibility({
      status: order.status,
      deliveredAt: order.deliveredAt,
      windowDays: order.organization.returnWindowDays,
      lines: order.lineItems.map((line) => ({ id: line.id, quantity: line.quantity, returned: returned.get(line.id) ?? 0 })),
      now: input.now ?? new Date(),
    });
    if (!eligibility.ok) return { ok: false as const, error: INELIGIBLE[eligibility.reason] };

    const checked = validateReturnLines(input.lines, eligibility.remaining);
    if (!checked.ok) return { ok: false as const, error: checked.message };

    const row = await tx.orderReturn.create({
      data: {
        organizationId: input.organizationId,
        orderId: order.id,
        reason: input.reason,
        details,
        lines: { create: checked.lines },
      },
      select: { id: true },
    });
    return { ok: true as const, data: row };
  });

  if (created.ok) {
    await notifyShopper(order.id, 'return-requested', { returnId: created.data.id });
    await notifyMerchant(order.id, 'return-requested', { returnId: created.data.id });
  }
  return created;
}

/** Take back a request the store hasn't answered yet. */
export async function withdrawReturn(input: {
  organizationId: string;
  customerId: string;
  returnId: string;
}): Promise<ReturnResult> {
  const claimed = await prisma.orderReturn.updateMany({
    where: {
      id: input.returnId,
      organizationId: input.organizationId,
      order: { customerId: input.customerId },
      status: 'REQUESTED',
    },
    data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
  });
  return claimed.count
    ? { ok: true, data: undefined }
    : { ok: false, error: 'The store has already answered this request, so it can’t be withdrawn.' };
}

/* ---------------- the merchant ---------------- */

type MerchantScope = { organizationId: string; returnId: string };

async function loadReturn(scope: MerchantScope) {
  return prisma.orderReturn.findFirst({
    where: { id: scope.returnId, organizationId: scope.organizationId },
    select: { id: true, status: true, orderId: true },
  });
}

/** Yes — and here's how to send it back. */
export async function approveReturn(scope: MerchantScope & { note?: string | null }): Promise<ReturnResult> {
  const found = await loadReturn(scope);
  if (!found) return NOT_FOUND;
  if (found.status !== 'REQUESTED') return { ok: false, error: 'Only a new request can be approved.' };

  const claimed = await prisma.orderReturn.updateMany({
    where: { id: found.id, status: 'REQUESTED' },
    data: { status: 'APPROVED', approvedAt: new Date(), merchantNote: scope.note?.trim().slice(0, 1000) || null },
  });
  if (!claimed.count) return CHANGED;

  await notifyShopper(found.orderId, 'return-approved', { returnId: found.id });
  return { ok: true, data: undefined };
}

/** No — and the shopper is told why, in the merchant's own words. */
export async function rejectReturn(scope: MerchantScope & { note: string }): Promise<ReturnResult> {
  const note = scope.note?.trim().slice(0, 1000);
  if (!note) return { ok: false, error: 'Tell the customer why — they’ll see this.' };

  const found = await loadReturn(scope);
  if (!found) return NOT_FOUND;
  if (found.status !== 'REQUESTED' && found.status !== 'APPROVED') {
    return { ok: false, error: 'This return has already been settled.' };
  }

  const claimed = await prisma.orderReturn.updateMany({
    where: { id: found.id, status: { in: ['REQUESTED', 'APPROVED'] } },
    data: { status: 'REJECTED', rejectedAt: new Date(), merchantNote: note },
  });
  if (!claimed.count) return CHANGED;

  await notifyShopper(found.orderId, 'return-rejected', { returnId: found.id });
  return { ok: true, data: undefined };
}

/**
 * Record money given back, under the order's lock: never more than is still
 * refundable, and the order's payment status moves with it.
 */
async function recordRefund(
  tx: Tx,
  input: {
    organizationId: string;
    orderId: string;
    returnId: string | null;
    amount: number;
    note: string | null;
    performedById: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await lockOrder(tx, input.orderId);
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: { paymentStatus: true, totalAmount: true, currency: true, refunds: { select: { amount: true } } },
  });
  if (!order) return { ok: false, error: 'Order not found' };

  const total = Number(order.totalAmount);
  const refunded = order.refunds.reduce((sum, r) => sum + Number(r.amount), 0);

  if (order.paymentStatus === 'DUE_ON_DELIVERY') {
    return { ok: false, error: 'This order’s payment hasn’t been recorded yet. Record the payment first.' };
  }
  const left = refundableAmount({ paymentStatus: order.paymentStatus, total, refunded });
  if (left <= 0) return { ok: false, error: 'There’s nothing left to refund on this order.' };

  const amount = Math.round(input.amount * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter the amount you sent back.' };
  if (amount > left) {
    return {
      ok: false,
      error: `You can refund at most ${formatMoney(Math.round(left * 100), order.currency)} on this order.`,
    };
  }

  await tx.orderRefund.create({
    data: {
      organizationId: input.organizationId,
      orderId: input.orderId,
      returnId: input.returnId,
      amount,
      note: input.note,
      recordedById: input.performedById,
    },
  });
  await tx.order.update({
    where: { id: input.orderId },
    data: { paymentStatus: paymentStatusAfterRefund(total, refunded + amount) },
  });
  return { ok: true };
}

/**
 * Put returned units back on the shelf they left from. Each line's dispatched
 * allocations say which store it came out of; the units go back there, first
 * store first. A line whose product is gone has nothing to restock.
 */
async function restockReturn(
  tx: Tx,
  input: { organizationId: string; returnId: string; performedById: string | null },
): Promise<void> {
  const lines = await tx.orderReturnLine.findMany({
    where: { returnId: input.returnId },
    select: {
      quantity: true,
      lineItem: {
        select: {
          allocations: {
            where: { status: 'DISPATCHED' },
            select: { inventoryItemId: true, warehouseId: true, quantity: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  for (const line of lines) {
    let remaining = line.quantity;
    for (const allocation of line.lineItem.allocations) {
      if (remaining <= 0) break;
      const back = Math.min(remaining, Number(allocation.quantity));
      if (back <= 0) continue;

      await tx.inventoryLevel.upsert({
        where: {
          inventoryItemId_warehouseId: { inventoryItemId: allocation.inventoryItemId, warehouseId: allocation.warehouseId },
        },
        create: { inventoryItemId: allocation.inventoryItemId, warehouseId: allocation.warehouseId, quantity: back },
        update: { quantity: { increment: back } },
      });
      await tx.stockMovement.create({
        data: {
          organizationId: input.organizationId,
          inventoryItemId: allocation.inventoryItemId,
          warehouseId: allocation.warehouseId,
          type: 'IN',
          quantity: back,
          referenceType: 'OrderReturn',
          referenceId: input.returnId,
          notes: 'Returned by the customer',
          performedById: input.performedById,
        },
      });
      remaining -= back;
    }
  }
}

/** The return is settled: money recorded, and — if the merchant says so — the items back in stock. */
export async function refundReturn(
  scope: MerchantScope & { amount: number; note?: string | null; restock: boolean; performedById: string | null },
): Promise<ReturnResult> {
  const found = await loadReturn(scope);
  if (!found) return NOT_FOUND;
  if (found.status !== 'REQUESTED' && found.status !== 'APPROVED') {
    return { ok: false, error: 'This return has already been settled.' };
  }

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.orderReturn.updateMany({
      where: { id: found.id, status: { in: ['REQUESTED', 'APPROVED'] } },
      data: { status: 'REFUNDED', refundedAt: new Date(), restocked: scope.restock },
    });
    if (!claimed.count) return CHANGED;

    const refunded = await recordRefund(tx, {
      organizationId: scope.organizationId,
      orderId: found.orderId,
      returnId: found.id,
      amount: scope.amount,
      note: scope.note?.trim().slice(0, 500) || null,
      performedById: scope.performedById,
    });
    // Throwing rolls the status change back with it.
    if (!refunded.ok) throw new RefundRefused(refunded.error);

    if (scope.restock) {
      await restockReturn(tx, { organizationId: scope.organizationId, returnId: found.id, performedById: scope.performedById });
    }
    return { ok: true as const, data: undefined };
  }).catch((error) => {
    if (error instanceof RefundRefused) return { ok: false as const, error: error.message };
    throw error;
  });

  if (result.ok) await notifyShopper(found.orderId, 'refunded', { returnId: found.id, refundAmount: scope.amount });
  return result;
}

/** Money back on an order that was cancelled after it was paid for. */
export async function refundCancelledOrder(input: {
  organizationId: string;
  orderId: string;
  amount: number;
  note?: string | null;
  performedById: string | null;
}): Promise<ReturnResult> {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    select: { id: true, status: true },
  });
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.status !== 'CANCELLED') {
    return { ok: false, error: 'Only a cancelled order is refunded here. For delivered items, use the customer’s return.' };
  }

  const result = await prisma.$transaction((tx) =>
    recordRefund(tx, {
      organizationId: input.organizationId,
      orderId: order.id,
      returnId: null,
      amount: input.amount,
      note: input.note?.trim().slice(0, 500) || null,
      performedById: input.performedById,
    }),
  );
  if (!result.ok) return result;

  await notifyShopper(order.id, 'refunded', { refundAmount: input.amount });
  return { ok: true, data: undefined };
}

class RefundRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundRefused';
  }
}
