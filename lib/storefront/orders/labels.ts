/*
 * lib/storefront/orders/labels.ts
 *
 * Every word a shopper reads about an order's state, in one place.
 *
 * Raw enum values never reach a screen (`AWAITING_TRANSFER` is not English),
 * and each status carries the sentence that says what happens NEXT — a
 * status a shopper can't act on is just a label. The admin has its own
 * equivalent in lib/format.ts; this one is written for the customer.
 */
import { TRANSFER_HOLD_HOURS } from '../mock/checkout';
import { formatDate, formatMoney } from '../format';
import type {
  OrderPaymentStatus,
  OrderReturnStatus,
  OrderStatus,
  OrderTimelineStep,
  StorefrontOrder,
} from './types';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Order received',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being packed',
  SHIPPED: 'On its way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_STATUS_LABEL: Record<OrderPaymentStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  AWAITING_TRANSFER: 'Awaiting your transfer',
  DUE_ON_DELIVERY: 'Pay on delivery',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
  FAILED: 'Payment failed',
};

/** What the shopper should expect, or do, next. */
export function paymentHint(status: OrderPaymentStatus): string {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return 'We’ll start packing as soon as your payment is confirmed.';
    case 'AWAITING_TRANSFER':
      return `Transfer the total to the account shown, using your order number as the reference, within ${TRANSFER_HOLD_HOURS} hours of ordering. The store confirms your order once the money arrives.`;
    case 'DUE_ON_DELIVERY':
      return 'Have the exact amount ready for the courier.';
    case 'PAID':
      return 'Thank you — nothing more to pay.';
    case 'PARTIALLY_REFUNDED':
      return 'The store has sent some of your payment back to you.';
    case 'REFUNDED':
      return 'The store has sent your payment back to you.';
    case 'FAILED':
      return 'Your payment didn’t go through. Contact us and we’ll sort it out.';
  }
}

export const RETURN_STATUS_LABEL: Record<OrderReturnStatus, string> = {
  REQUESTED: 'Waiting for the store',
  APPROVED: 'Approved — send it back',
  REJECTED: 'Declined',
  REFUNDED: 'Refunded',
  WITHDRAWN: 'Withdrawn',
};

/** What happens next with a return, in one sentence. */
export function returnHint(status: OrderReturnStatus): string {
  switch (status) {
    case 'REQUESTED':
      return 'Keep the items for now. The store will reply with how to send them back, and we’ll email you.';
    case 'APPROVED':
      return 'Send the items back as the store describes. Your refund follows once they’ve sorted it.';
    case 'REJECTED':
      return 'The store can’t take these items back.';
    case 'REFUNDED':
      return 'The store says it has sent your money back. It can take a few working days to arrive.';
    case 'WITHDRAWN':
      return 'You withdrew this request.';
  }
}

/**
 * Money on a cancelled order that had been paid: what the store owes, and
 * what it says it has sent. Only ever "the store says" — the app records
 * refunds, it doesn't make them.
 */
export function cancelledRefundSentence(
  order: Pick<StorefrontOrder, 'refunds' | 'totals' | 'currency'>,
  locale: string,
): string {
  const { owed, total, lastAt } = order.refunds;
  const money = (minor: number) => formatMoney(minor, order.currency);
  if (owed > 0 && total === 0) {
    return `You paid ${money(order.totals.total)}, so the store owes it back to you. We’ll email you when they’ve sent it.`;
  }
  if (owed > 0) {
    return `The store has sent ${money(total)} back to you so far; ${money(owed)} is still to come.`;
  }
  return `The store says it sent ${money(total)} back to you${
    lastAt ? ` on ${formatDate(lastAt, locale)}` : ''
  }. It can take a few working days to arrive.`;
}

/* The path an order actually travels. Cancelled is not a step on it — an
 * order that stops has a state, not a stage, and the detail page says so
 * separately rather than drawing a broken track. */
const JOURNEY: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

const DESCRIPTION: Record<OrderStatus, string> = {
  PENDING: 'We have your order.',
  CONFIRMED: 'Your order is confirmed.',
  PROCESSING: 'Your items are being packed.',
  SHIPPED: 'Your parcel is with the courier.',
  DELIVERED: 'Delivered — we hope it’s just right.',
  CANCELLED: 'This order was cancelled.',
};

/**
 * The status strip.
 *
 * Each step is dated with when the order actually reached it. A step the
 * order passed without stopping (shipped straight from confirmed, so never
 * "being packed") is shown done but undated — a step invents no timestamp it
 * doesn't have: a made-up "packed at 14:02" is exactly the kind of detail a
 * shopper would quote back at someone.
 */
export function orderTimeline(
  status: OrderStatus,
  placedAt: string,
  stageDates: Partial<StorefrontOrder['stageDates']> = {},
): OrderTimelineStep[] {
  const reached = JOURNEY.indexOf(status);
  const dates: Record<OrderStatus, string | null> = {
    PENDING: placedAt,
    CONFIRMED: stageDates.confirmedAt ?? null,
    PROCESSING: stageDates.packingAt ?? null,
    SHIPPED: stageDates.shippedAt ?? null,
    DELIVERED: stageDates.deliveredAt ?? null,
    CANCELLED: null,
  };

  return JOURNEY.map((step, index) => ({
    status: step,
    label: ORDER_STATUS_LABEL[step],
    description: DESCRIPTION[step],
    at: index <= reached ? dates[step] : null,
    done: status !== 'CANCELLED' && index <= reached,
    current: status !== 'CANCELLED' && index === reached,
  }));
}
