/*
 * Cart / order money math. Pure functions, unit-tested. All amounts are
 * minor units (kobo). This is the single source of truth for totals — the
 * cart store, checkout, and the mock order API all call `computeTotals`.
 */
import type { AppliedCoupon, CartItem, Money, OrderTotals, ShippingMethod } from './types';
import { bagVat } from '@/lib/tax';

/*
 * Delivery prices belong to each merchant and depend on the address
 * (lib/storefront/delivery/). Until checkout has an address and the shopper
 * has picked an option, a total has NO delivery line in it — it is marked
 * `shippingPending` and screens say "calculated at checkout" rather than
 * quoting a price nobody set. The methods below are demo fixtures only.
 */
export const DEFAULT_SHIPPING: Money = 250_000; // ₦2,500 — demo fixture price

export const SHIPPING_METHODS: ShippingMethod[] = [
  {
    id: 'standard',
    label: 'Standard delivery',
    description: '2–4 working days',
    price: DEFAULT_SHIPPING,
    eta: { minMinutes: 2880, maxMinutes: 5760, unit: 'DAYS' },
  },
  {
    id: 'express',
    label: 'Express delivery',
    description: 'Next working day (select cities)',
    price: 600_000,
    eta: { minMinutes: 1440, maxMinutes: 1440, unit: 'DAYS' },
  },
  {
    id: 'pickup',
    label: 'Pickup point',
    description: 'Collect from a partner location, 2–3 days',
    price: 0,
    eta: { minMinutes: 2880, maxMinutes: 4320, unit: 'DAYS' },
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
  /**
   * The store's VAT rate as a percentage when it is VAT registered, else
   * null — then there is no VAT in the total at all (lib/tax.ts, ROADMAP 14.1).
   */
  vatRatePct?: number | null;
  /**
   * VAT is ADDED to wholesale lines (`atWholesale`) rather than included —
   * a trade buyer at a shop whose wholesale prices are before VAT (ROADMAP
   * 21.2). Retail lines in the same bag still include it.
   */
  vatAdded?: boolean;
}

export function computeTotals({
  items,
  coupon = null,
  shippingMethod = null,
  currency = 'NGN',
  vatRatePct = null,
  vatAdded = false,
}: ComputeTotalsInput): OrderTotals {
  const subtotal = cartSubtotal(items);

  const discount = discountAmount(coupon, subtotal);

  const discountedSubtotal = Math.max(0, subtotal - discount);

  /* No method chosen yet → no delivery charge in the figure, and the total
   * says so. A discount applies to goods, never to delivery. */
  const shipping = shippingMethod?.price ?? 0;

  // VAT is already in the listed prices — stated, never added.
  // Except a trade buyer's wholesale lines, where the shop adds it (21.2).
  const beforeVat = vatAdded ? cartSubtotal(items.filter((i) => i.atWholesale)) : 0;
  const vat = bagVat({ beforeVat, inclusive: subtotal - beforeVat, discount, ratePct: vatRatePct });
  const tax = vat.added + vat.included;

  const total = discountedSubtotal + vat.added + shipping;

  return { subtotal, discount, shipping, tax, taxAdded: vat.added, total, currency, shippingPending: !shippingMethod };
}

/* An order reference is not money, and there must be exactly one generator
 * for it: see `nextReference` in lib/storefront/orders/create.ts,
 * which is the one checkout actually calls. An unused second generator here
 * was how a store ends up with two reference formats. */
