/*
 * Cart / order money math. Pure functions, unit-tested. All amounts are
 * minor units (kobo). This is the single source of truth for totals — the
 * cart store, checkout, and the mock order API all call `computeTotals`.
 */
import type { AppliedCoupon, CartItem, Money, OrderTotals, ShippingMethod } from './types';

/*
 * Delivery prices belong to each merchant and depend on the address
 * (lib/storefront/delivery/). Until checkout has an address and the shopper
 * has picked an option, a total has NO delivery line in it — it is marked
 * `shippingPending` and screens say "calculated at checkout" rather than
 * quoting a price nobody set. The methods below are demo fixtures only.
 */
export const DEFAULT_SHIPPING: Money = 250_000; // ₦2,500 — demo fixture price
export const VAT_RATE = 0.075; // 7.5%

export const SHIPPING_METHODS: ShippingMethod[] = [
  {
    id: 'standard',
    label: 'Standard delivery',
    description: '2–4 working days',
    price: DEFAULT_SHIPPING,
    etaDays: [2, 4],
  },
  {
    id: 'express',
    label: 'Express delivery',
    description: 'Next working day (select cities)',
    price: 600_000,
    etaDays: [1, 1],
  },
  {
    id: 'pickup',
    label: 'Pickup point',
    description: 'Collect from a partner location, 2–3 days',
    price: 0,
    etaDays: [2, 3],
  },
];

/*
 * Discount codes belong to the merchant (Sales → Discount codes) and are
 * resolved on the server — lib/storefront/discounts/. There is no built-in
 * code here: a store's codes are its own, and a code hard-coded in the
 * bundle would work in every store that ever ran this build.
 */

/**
 * What a code takes off the GOODS.
 *
 * Never more than the goods are worth, and never anything at all below the
 * code's minimum spend — the same rule the server applies when the order is
 * placed, because this is the function both of them call.
 */
export function discountAmount(coupon: AppliedCoupon | null, subtotal: Money): Money {
  if (!coupon) return 0;
  if (coupon.minSubtotal != null && subtotal < coupon.minSubtotal) return 0;

  const raw =
    coupon.kind === 'percent'
      ? Math.round((subtotal * coupon.value) / 100)
      : coupon.value;

  return Math.max(0, Math.min(raw, subtotal));
}

export function lineSubtotal(item: Pick<CartItem, 'unitPrice' | 'quantity'>): Money {
  return item.unitPrice * item.quantity;
}

export function cartSubtotal(items: CartItem[]): Money {
  return items.reduce((sum, i) => sum + lineSubtotal(i), 0);
}

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

export interface ComputeTotalsInput {
  items: CartItem[];
  coupon?: AppliedCoupon | null;
  shippingMethod?: ShippingMethod | null;
  currency?: string;
}

export function computeTotals({
  items,
  coupon = null,
  shippingMethod = null,
  currency = 'NGN',
}: ComputeTotalsInput): OrderTotals {
  const subtotal = cartSubtotal(items);

  const discount = discountAmount(coupon, subtotal);

  const discountedSubtotal = Math.max(0, subtotal - discount);

  /* No method chosen yet → no delivery charge in the figure, and the total
   * says so. A discount applies to goods, never to delivery. */
  const shipping = shippingMethod?.price ?? 0;

  // VAT modelled as already included in listed prices → shown for info only
  const tax = Math.round((discountedSubtotal * VAT_RATE) / (1 + VAT_RATE));

  const total = discountedSubtotal + shipping;

  return { subtotal, discount, shipping, tax, total, currency, shippingPending: !shippingMethod };
}

/* An order reference is not money, and there must be exactly one generator
 * for it: see `nextReference` in lib/storefront/orders/create.ts,
 * which is the one checkout actually calls. An unused second generator here
 * was how a store ends up with two reference formats. */
