/*
 * lib/storefront/checkout/payment-terms.ts
 *
 * Which ways of paying an ORDER may use, given what's in it.
 *
 * A merchant can mark a product "payment required before delivery"
 * (`InventoryItem.requiresPrepayment`) — a phone, say, that they won't hand
 * to a courier on trust. That is a rule about the whole order, not about one
 * line: a courier collects once, for everything in the box, so a single
 * strict item takes pay on delivery off the entire order. Splitting the bag
 * into two orders would be a different, much bigger promise, and we don't
 * make it silently.
 *
 * Pure functions, no React and no Prisma, because the same three answers are
 * needed in three places and must agree in all of them:
 *   - the payment step, which greys the option out and says why;
 *   - checkout-service.ts, which refuses before submitting;
 *   - orders/create.ts, which refuses over the merchant's own catalogue —
 *     the only one of the three that counts.
 */
import type { CartItem } from '../types';
import type { PaymentMethodOption } from './types';

/** All a rule needs to know about a line. */
type Line = Pick<CartItem, 'name' | 'requiresPrepayment'>;

/** The items in the bag the merchant wants paid for up front. */
export function prepaidItems<T extends Line>(items: T[]): T[] {
  return items.filter((item) => item.requiresPrepayment);
}

/** Does this bag have to be paid for before it's delivered? */
export function orderRequiresPrepayment(items: Line[]): boolean {
  return items.some((item) => item.requiresPrepayment);
}

/**
 * Is this way of paying allowed for this bag?
 *
 * Only settle-on-delivery methods are ever blocked — paying online is always
 * allowed, whatever the terms.
 */
export function isPaymentMethodAllowed(method: PaymentMethodOption, items: Line[]): boolean {
  return !method.settlesOnDelivery || !orderRequiresPrepayment(items);
}

/** The one sentence a shopper reads about it, wherever they meet the rule. */
export const PREPAYMENT_REQUIRED_MESSAGE =
  'Pay on delivery isn’t available because one or more items in your order require payment before delivery.';

/**
 * The same sentence, naming the items — so the shopper can decide whether to
 * pay online or take that item out, rather than guess which one it is.
 *
 * Kept to three names: a bag of twenty prepaid items doesn't need a list.
 */
export function prepaymentReason(items: Line[]): string {
  const names = [...new Set(prepaidItems(items).map((item) => item.name))];
  if (names.length === 0) return '';
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length - 3;
  return rest > 0
    ? `${shown} and ${rest} other item${rest === 1 ? '' : 's'} must be paid for before delivery.`
    : `${shown} must be paid for before delivery.`;
}
