/*
 * lib/storefront/orders/policy.ts
 *
 * What a shopper may do with an order after placing it — cancel it, send
 * items back — and how much money is still theirs to get back. Pure: no
 * database, no clock of its own, so the account page, the server actions
 * and the merchant's screens all ask the same questions and get the same
 * answers, and tests can pin the edges.
 *
 * The rules, in the words the shopper reads:
 *   - You can cancel an order yourself until the store starts packing it.
 *   - You can ask to return items for `returnWindowDays` after delivery, if
 *     the store takes returns at all (null = it doesn't, and nothing says so).
 *   - You can't ask to return more of a line than you received, less what is
 *     already in a return — open, done or declined; withdrawing gives it back.
 */

/** Before packing: after that the merchant has done work the shopper can't undo. */
export const CUSTOMER_CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED'] as const;

export function customerCanCancel(status: string): boolean {
  return (CUSTOMER_CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/** Longest window a merchant can set; a year covers every real policy. */
export const MAX_RETURN_WINDOW_DAYS = 365;

export const RETURN_REASONS = {
  'changed-mind': 'I changed my mind',
  'doesnt-fit': 'It doesn’t fit',
  'not-as-described': 'Not as described',
  damaged: 'Arrived damaged or faulty',
  'wrong-item': 'Wrong item sent',
  other: 'Something else',
} as const;

export type ReturnReason = keyof typeof RETURN_REASONS;

export function isReturnReason(value: string): value is ReturnReason {
  return Object.prototype.hasOwnProperty.call(RETURN_REASONS, value);
}

/**
 * A return in one of these counts against what's left to return. A declined
 * one does too — the store's answer is final, or a shopper could simply ask
 * again. Only a request the shopper withdrew gives its items back.
 */
export const COUNTED_RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REFUNDED', 'REJECTED'] as const;

export function countsAgainstReturnable(status: string): boolean {
  return (COUNTED_RETURN_STATUSES as readonly string[]).includes(status);
}

/** The last moment a return can be asked for, or null when there is none. */
export function returnDeadline(deliveredAt: Date | string | null, windowDays: number | null): Date | null {
  if (!deliveredAt || windowDays === null || windowDays <= 0) return null;
  const deadline = new Date(deliveredAt);
  deadline.setTime(deadline.getTime() + windowDays * 86_400_000);
  return deadline;
}

export interface ReturnableLine {
  id: string;
  quantity: number;
  /** already in a return that counts (see COUNTED_RETURN_STATUSES) */
  returned: number;
}

export type ReturnEligibility =
  | { ok: true; deadline: Date; remaining: Map<string, number> }
  | { ok: false; reason: 'no-returns' | 'not-delivered' | 'window-closed' | 'nothing-left' };

/** Whether this order can take a return request right now, and how much of each line. */
export function returnEligibility(input: {
  status: string;
  deliveredAt: Date | string | null;
  windowDays: number | null;
  lines: ReturnableLine[];
  now: Date;
}): ReturnEligibility {
  if (input.windowDays === null || input.windowDays <= 0) return { ok: false, reason: 'no-returns' };
  if (input.status !== 'DELIVERED' || !input.deliveredAt) return { ok: false, reason: 'not-delivered' };

  const deadline = returnDeadline(input.deliveredAt, input.windowDays)!;
  if (input.now.getTime() > deadline.getTime()) return { ok: false, reason: 'window-closed' };

  const remaining = new Map<string, number>();
  for (const line of input.lines) {
    const left = line.quantity - line.returned;
    if (left > 0) remaining.set(line.id, left);
  }
  if (remaining.size === 0) return { ok: false, reason: 'nothing-left' };

  return { ok: true, deadline, remaining };
}

export type ReturnLineRequest = { orderLineItemId: string; quantity: number };

/**
 * Check what the shopper asked to send back against what's left. Quantities
 * of 0 are dropped (the form sends every line); anything else must be a
 * whole number within what remains.
 */
export function validateReturnLines(
  requested: ReturnLineRequest[],
  remaining: Map<string, number>,
): { ok: true; lines: ReturnLineRequest[] } | { ok: false; message: string } {
  const merged = new Map<string, number>();
  for (const line of requested) {
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { ok: false, message: 'Choose how many of each item you’re sending back.' };
    }
    if (quantity === 0) continue;
    merged.set(line.orderLineItemId, (merged.get(line.orderLineItemId) ?? 0) + quantity);
  }

  if (merged.size === 0) return { ok: false, message: 'Choose at least one item to send back.' };

  for (const [id, quantity] of merged) {
    const left = remaining.get(id);
    if (left === undefined) return { ok: false, message: 'One of those items can’t be returned.' };
    if (quantity > left) {
      return { ok: false, message: `You can send back at most ${left} of one of those items.` };
    }
  }

  return { ok: true, lines: [...merged].map(([orderLineItemId, quantity]) => ({ orderLineItemId, quantity })) };
}

/** Money is compared in minor units so ₦0.01 of float noise can't block a full refund. */
const toMinor = (major: number) => Math.round(major * 100);

/** How much of what the shopper paid hasn't gone back yet. Major units in, major units out. */
export function refundableAmount(input: { paymentStatus: string; total: number; refunded: number }): number {
  if (input.paymentStatus !== 'PAID' && input.paymentStatus !== 'PARTIALLY_REFUNDED') return 0;
  return Math.max(0, toMinor(input.total) - toMinor(input.refunded)) / 100;
}

/** The payment status an order moves to once `refunded` has gone back out of `total`. */
export function paymentStatusAfterRefund(total: number, refunded: number): 'REFUNDED' | 'PARTIALLY_REFUNDED' {
  return toMinor(refunded) >= toMinor(total) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

/**
 * What a return is worth, before the merchant decides: the lines' prices,
 * less the order's discount spread across the goods in proportion. Delivery
 * isn't included — the merchant can add it when they record the refund.
 */
export function suggestedReturnRefund(input: {
  subtotal: number;
  discount: number;
  lines: { unitPrice: number; quantity: number }[];
}): number {
  const goods = input.lines.reduce((sum, line) => sum + toMinor(line.unitPrice) * line.quantity, 0);
  const subtotal = toMinor(input.subtotal);
  const discountShare = subtotal > 0 ? Math.round((toMinor(input.discount) * goods) / subtotal) : 0;
  return Math.max(0, goods - discountShare) / 100;
}
