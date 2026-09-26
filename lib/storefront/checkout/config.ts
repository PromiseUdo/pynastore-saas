/*
 * lib/storefront/checkout/config.ts
 *
 * One tenant's checkout configuration, resolved in one place.
 *
 * This is the seam Section 36/38 of the phase brief asks for: eventually a
 * store's currency, accepted payment methods, delivery options and checkout
 * rules are ROWS, set per tenant in the admin. Today they're fixtures. What
 * matters is that no component reads a fixture or hardcodes a currency —
 * they all read the record this returns, so the day it comes from the
 * database the components are untouched.
 *
 * Same shape as lib/storefront/catalog.ts: async, takes a `StoreScope`,
 * server-callable, resolves nothing tenant-specific yet.
 */
import { formatEta, formatReady, type DeliveryEta } from '../delivery/eta';
import type { StoreScope } from '../types';
import type { CheckoutConfig } from './types';
import { SHIPPING_METHODS } from '../pricing';
import {
  CHECKOUT_COUNTRIES,
  CHECKOUT_PAYMENT_METHODS,
  CHECKOUT_TAX_ENABLED,
  GUEST_CHECKOUT_ENABLED,
  ORDER_NOTES_ENABLED,
} from '../mock/checkout';

/* Matches catalog.ts — simulate async so real IO is a transparent swap. */
async function ok<T>(value: T): Promise<T> {
  return value;
}

/**
 * The checkout configuration for a store.
 *
 * `_scope` is unused today and deliberately kept: it is the parameter that
 * makes the call tenant-scoped, so adding the lookup later doesn't change a
 * single caller's signature.
 */
export async function getCheckoutConfig(_scope?: StoreScope): Promise<CheckoutConfig> {
  const deliveryMethods = SHIPPING_METHODS;

  return ok({
    currency: 'NGN',
    locale: 'en-NG',
    countries: CHECKOUT_COUNTRIES,
    defaultCountryCode: CHECKOUT_COUNTRIES[0]?.code ?? 'NG',
    deliveryMethods,
    defaultDeliveryMethodId: deliveryMethods[0]?.id ?? '',
    deliveryAvailable: deliveryMethods.length > 0,
    // Bank transfer depends on the merchant's own accounts, which only the
    // server can read — see ./store-config.ts, which adds it when there are some.
    paymentMethods: CHECKOUT_PAYMENT_METHODS.filter((m) => m.enabled),
    transferAccounts: [],
    taxEnabled: CHECKOUT_TAX_ENABLED,
    guestCheckoutEnabled: GUEST_CHECKOUT_ENABLED,
    orderNotesEnabled: ORDER_NOTES_ENABLED,
  });
}

/* ---------------- lookups over a config ---------------- */

export function findCountry(config: CheckoutConfig, code: string) {
  return config.countries.find((c) => c.code === code) ?? null;
}

export function findDeliveryMethod(config: CheckoutConfig, id: string | null) {
  if (!id) return null;
  return config.deliveryMethods.find((m) => m.id === id) ?? null;
}

export function findPaymentMethod(config: CheckoutConfig, id: string | null) {
  if (!id) return null;
  return config.paymentMethods.find((m) => m.id === id) ?? null;
}

/**
 * The delivery window as a sentence: "45 minutes", "2–3 hours", "3–5 working
 * days", "Same day".
 *
 * Derived from the method's `eta` rather than stored as prose, so the estimate
 * the shopper reads can never disagree with the dates the order carries (see
 * `estimateWindow` in ../orders/read.ts).
 */
export function deliveryEstimate(method: { eta: DeliveryEta; kind?: 'delivery' | 'pickup' }): string {
  return method.kind === 'pickup' ? formatReady(method.eta) : formatEta(method.eta);
}
