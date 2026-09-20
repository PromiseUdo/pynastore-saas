/*
 * lib/storefront/orders/types.ts
 *
 * What a placed order looks like to everything that reads one — the
 * confirmation page, the account's order history, the guest lookup.
 *
 * Money is in MINOR units here (kobo), like the rest of the storefront; the
 * database stores major units and ./read.ts converts at that boundary, the
 * same way the catalogue mapper does for prices.
 */
import type { Money } from '../types';
import type { TransferAccount } from '../checkout/types';

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export type OrderPaymentStatus =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_TRANSFER'
  | 'DUE_ON_DELIVERY'
  | 'PAID'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'FAILED';

export type OrderReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDED' | 'WITHDRAWN';

/** A request to send items back, as the shopper sees it. */
export interface StorefrontOrderReturn {
  id: string;
  status: OrderReturnStatus;
  reasonLabel: string;
  details: string | null;
  /** what the store wrote back: how to send it, or why not */
  storeNote: string | null;
  requestedAt: string;
  /** when the store answered, or the shopper withdrew */
  updatedAt: string | null;
  /** what the store recorded sending back for this return; null until refunded */
  refunded: Money | null;
  lines: { orderLineItemId: string; name: string; variantName: string | null; quantity: number }[];
}

export interface StorefrontOrderLine {
  id: string;
  productId: string | null;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  imageUrl: string | null;
  /** null once the product is gone — the line still reads correctly */
  slug: string | null;
  quantity: number;
  unitPrice: Money;
  totalPrice: Money;
}

export interface StorefrontOrder {
  reference: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethodId: string;
  /** bank transfer orders: where to send the money, as shown when ordering */
  transferDetails: TransferAccount[] | null;
  placedAt: string;
  /** when each later stage happened; null until it does */
  stageDates: { confirmedAt: string | null; packingAt: string | null; shippedAt: string | null; deliveredAt: string | null };

  contact: { firstName: string; lastName: string; email: string; phone: string };
  shippingAddress: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    country: string;
    postalCode: string | null;
  };

  delivery: {
    methodId: string;
    label: string;
    fee: Money;
    /** working days, as quoted at checkout */
    etaDays: [number, number];
    /** ISO dates bracketing the estimate, worked out from `placedAt` */
    estimated: { from: string; to: string };
  };

  currency: string;
  totals: { subtotal: Money; discount: Money; shipping: Money; tax: Money; total: Money };
  /** the code used, as it read when the order was placed; null if none */
  discountCode: string | null;

  note: string | null;
  lines: StorefrontOrderLine[];
  itemCount: number;

  /** null unless cancelled; `by` says who, which decides what the page says */
  cancellation: { by: 'customer' | 'merchant' | 'payment-timeout'; at: string | null } | null;
  /** money the store has recorded sending back, and — for a cancelled paid order — what it still owes */
  refunds: { total: Money; owed: Money; lastAt: string | null };
  returns: StorefrontOrderReturn[];
  /**
   * What the shopper may do now — decided by ./policy.ts at read time and
   * decided AGAIN by the server when they act, so this only chooses buttons.
   */
  selfService: {
    canCancel: boolean;
    returns:
      | { open: true; deadline: string; remaining: Record<string, number> }
      | { open: false; reason: 'no-returns' | 'not-delivered' | 'window-closed' | 'nothing-left'; deadline: string | null };
  };
}

/** One line of an order's history, for the status strip on a detail page. */
export interface OrderTimelineStep {
  status: OrderStatus;
  label: string;
  description: string;
  /** null when it hasn't happened yet */
  at: string | null;
  done: boolean;
  current: boolean;
}
