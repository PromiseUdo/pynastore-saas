/*
 * lib/sales/order-labels.ts
 *
 * The admin's words and badge colours for online-store orders, in one place
 * (the storefront has its own, written for shoppers: lib/storefront/orders/labels.ts).
 * Colour is never the only signal — every badge carries its label.
 */
export type BadgeVariant =
  | 'draft'
  | 'rejected'
  | 'pending'
  | 'processing'
  | 'approved'
  | 'completed'
  | 'cancelled'
  | 'success'
  | 'warning'
  | 'info'
  | 'destructive';

/**
 * Where a sale came from. "In store" rather than "Walk-in" because that is
 * what a shop owner calls it, and "Online" rather than "Storefront" because
 * that is what their customer calls it.
 */
export const ORDER_CHANNEL_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  WALK_IN: 'In store',
  PHONE: 'Phone',
};

export const ORDER_CHANNEL_VARIANT: Record<string, BadgeVariant> = {
  ONLINE: 'info',
  WALK_IN: 'approved',
  PHONE: 'draft',
};

/** How a counter sale was paid, in the merchant's words. */
export const COUNTER_PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  transfer: 'Bank transfer',
  later: 'Paying later',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'New',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const ORDER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING: 'pending',
  CONFIRMED: 'approved',
  PROCESSING: 'processing',
  SHIPPED: 'processing',
  DELIVERED: 'completed',
  CANCELLED: 'cancelled',
};

export const ORDER_PAYMENT_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  AWAITING_TRANSFER: 'Awaiting transfer',
  DUE_ON_DELIVERY: 'Pay on delivery',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
  FAILED: 'Payment failed',
};

export const ORDER_PAYMENT_VARIANT: Record<string, BadgeVariant> = {
  AWAITING_PAYMENT: 'warning',
  AWAITING_TRANSFER: 'warning',
  DUE_ON_DELIVERY: 'info',
  PAID: 'success',
  PARTIALLY_REFUNDED: 'info',
  REFUNDED: 'draft',
  FAILED: 'destructive',
};

/** A customer's request to send items back from an online order. */
export const ORDER_RETURN_LABEL: Record<string, string> = {
  REQUESTED: 'Awaiting you',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  REFUNDED: 'Refunded',
  WITHDRAWN: 'Withdrawn',
};

export const ORDER_RETURN_VARIANT: Record<string, BadgeVariant> = {
  REQUESTED: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REFUNDED: 'completed',
  WITHDRAWN: 'cancelled',
};

/** What to do next with a return, in the merchant's words. */
export function returnNextStep(status: string): string | null {
  switch (status) {
    case 'REQUESTED':
      return 'Approve it and tell the customer how to send it back, or decline it with a reason. You can also refund straight away if you don’t need the item back.';
    case 'APPROVED':
      return 'Once the items are back (or you’ve decided you don’t need them), send the money and record the refund here.';
    default:
      return null;
  }
}

/** How the customer chose to pay, as the merchant would say it. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  squad: 'Online (Squad)',
  pod: 'Pay on delivery',
  transfer: 'Bank transfer to you',
  card: 'Card',
  // At the counter (features/sales/counter-sale.ts).
  cash: 'Cash',
  later: 'Paying later',
};

/** The one sentence under the badges that says what happens next. */
export function nextStepHint(input: {
  status: string;
  paymentStatus: string;
  /** ONLINE | WALK_IN | PHONE — a counter sale has a different life */
  channel?: string;
  cancelReason: string | null;
  holdMinutes: number;
  transferHoldHours: number;
  /** open return requests waiting on the merchant */
  returnsAwaiting?: number;
}): string | null {
  const { status, paymentStatus, cancelReason, holdMinutes } = input;
  const byCustomer = cancelReason === 'customer';

  /* A counter sale is over the moment it is rung up: the goods have gone and
   * there is no courier, no confirmation and no hold to expire. The only
   * thing that can still be outstanding is the money. */
  if (input.channel && input.channel !== 'ONLINE') {
    if (status === 'CANCELLED') return 'Cancelled. The stock went back on the shelf.';
    if (input.returnsAwaiting) {
      return 'The customer has asked to return something — answer the request below.';
    }
    if (paymentStatus === 'AWAITING_PAYMENT') {
      return 'Sold, but not paid for yet. Record the payment once the customer settles up.';
    }
    if (paymentStatus === 'PARTIALLY_REFUNDED') return 'Part of this sale has been refunded.';
    if (paymentStatus === 'REFUNDED') return 'This sale has been refunded in full.';
    return null;
  }

  if (status === 'CANCELLED') {
    if (paymentStatus === 'AWAITING_TRANSFER' && cancelReason === 'payment-timeout') {
      return `Cancelled automatically: no transfer was confirmed within ${input.transferHoldHours} hours, so the stock went back on sale. If the money has since arrived, you can still confirm it.`;
    }
    if (paymentStatus === 'PAID' || paymentStatus === 'PARTIALLY_REFUNDED') {
      return `${byCustomer ? 'The customer cancelled this after paying' : 'Cancelled after the customer paid'} — refund them (from your Squad dashboard for online payments, or your bank for transfers), then record the refund here so they can see it.`;
    }
    if (paymentStatus === 'REFUNDED') return 'Cancelled and refunded — nothing left to do.';
    if (cancelReason === 'payment-timeout') {
      return `Cancelled automatically: the customer didn’t finish paying within ${holdMinutes} minutes, so the stock went back on sale.`;
    }
    return byCustomer
      ? 'The customer cancelled this order before you packed it. The stock went back on sale.'
      : 'Cancelled. The stock went back on sale.';
  }
  if (input.returnsAwaiting) {
    return input.returnsAwaiting === 1
      ? 'The customer has asked to return items — answer the request below.'
      : `The customer has ${input.returnsAwaiting} return requests waiting — answer them below.`;
  }
  if (paymentStatus === 'AWAITING_TRANSFER') {
    return `Waiting for the customer’s bank transfer. Check your bank account for the total with this order number as the reference, then confirm it. Unconfirmed after ${input.transferHoldHours} hours, the order is cancelled and its stock released.`;
  }
  if (paymentStatus === 'AWAITING_PAYMENT') {
    return `Waiting for the customer to pay online. If they don’t within ${holdMinutes} minutes of ordering, the order is cancelled and its stock released.`;
  }
  switch (status) {
    case 'PENDING':
      return 'New pay-on-delivery order — confirm it once you can fulfil it.';
    case 'CONFIRMED':
      return 'Ready to pack. Start packing so the customer can see it’s being prepared, or mark it as shipped if it’s already on its way. Shipping takes the stock out of your store.';
    case 'PROCESSING':
      return 'Being packed. Mark it as shipped once it’s with the courier — that takes the stock out of your store and emails the customer.';
    case 'SHIPPED':
      return paymentStatus === 'DUE_ON_DELIVERY'
        ? 'On its way. When the courier delivers it, mark it as delivered and record the payment.'
        : 'On its way. Mark it as delivered once it arrives.';
    case 'DELIVERED':
      if (paymentStatus === 'DUE_ON_DELIVERY') return 'Delivered, but the payment hasn’t been recorded yet.';
      if (paymentStatus === 'PARTIALLY_REFUNDED') return 'Delivered. Part of the payment has been refunded.';
      if (paymentStatus === 'REFUNDED') return 'Delivered, and the payment has been refunded in full.';
      return 'Delivered and paid — nothing left to do.';
    default:
      return null;
  }
}
