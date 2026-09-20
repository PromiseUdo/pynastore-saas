/*
 * lib/storefront/checkout/totals.ts
 *
 * Checkout's money boundary.
 *
 * There is exactly ONE function in the storefront that adds up an order —
 * `computeTotals` in lib/storefront/pricing.ts — and the cart page, the
 * mini-cart and this file all call it. This module exists to give checkout a
 * signature in its own vocabulary (a selected delivery method, a config) and
 * to be the single seam the backend's authoritative total replaces later.
 * It does not do arithmetic of its own beyond counting items.
 *
 * THE CLIENT'S TOTAL IS NOT AUTHORITATIVE. Everything here is a preview
 * computed from a snapshot that is, by construction, possibly stale — it
 * exists so the shopper knows roughly what they're agreeing to. The order
 * total that matters is the one the server computes from its own prices, its
 * own stock and its own delivery rates. Nothing in this file should ever be
 * treated as a promise.
 */
import type { AppliedCoupon, CartItem, OrderTotals, ShippingMethod } from '../types';
import type { CheckoutConfig } from './types';
import { cartItemCount, computeTotals, lineSubtotal } from '../pricing';

export interface CheckoutTotalsInput {
  items: CartItem[];
  /** null until the shopper picks one — totals then quote the store default */
  deliveryMethod?: ShippingMethod | null;
  /** Phase 6 never applies one; the parameter is the seam for when it does */
  discount?: AppliedCoupon | null;
  config: CheckoutConfig;
}

/**
 * What this order costs, as far as the browser can tell.
 *
 * Currency comes from the store's config, never from a literal in a
 * component — see `checkoutCurrency` for the one case where a cart line
 * disagrees with the config.
 */
export function calculateCheckoutTotals({
  items,
  deliveryMethod = null,
  discount = null,
  config,
}: CheckoutTotalsInput): OrderTotals {
  return computeTotals({
    items,
    coupon: discount,
    shippingMethod: deliveryMethod,
    currency: checkoutCurrency(items, config),
  });
}

/**
 * The currency to print.
 *
 * The store's configured currency wins. A cart line carries its own
 * currency (it's a snapshot of what the product was listed in), so if a line
 * disagrees the LINE is honoured — showing a ₦ figure for something priced
 * in dollars would be worse than a mixed-currency bag, which the catalogue
 * cannot currently produce anyway.
 */
export function checkoutCurrency(items: CartItem[], config: CheckoutConfig): string {
  return items[0]?.currency ?? config.currency;
}

/** Units in the order, matching the header badge. */
export function checkoutItemCount(items: CartItem[]): number {
  return cartItemCount(items);
}

/** One line's money, re-exported so review/summary don't reach past this file. */
export { lineSubtotal };
