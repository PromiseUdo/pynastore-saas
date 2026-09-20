/*
 * lib/storefront/store-claims.ts
 *
 * The one-line promises the storefront chrome makes on every page — how
 * orders arrive (utility bar) and how shoppers can pay (footer). Pure, and
 * built only from what checkout will actually do for this store: its
 * delivery options (Settings → Delivery and returns) and its payment
 * methods (lib/storefront/checkout/store-config.ts).
 *
 * These used to be fixed copy — "Nationwide delivery in 2–4 working days",
 * "Secure payments by Paystack" — on every merchant's store, whatever their
 * delivery set-up, and after checkout had moved to Squad. A store with
 * nothing to promise now promises nothing.
 */
import type { DeliveryPromise } from './types';
import type { PaymentMethodOption } from './checkout/types';

/** "Delivery across Nigeria · Collect in store", or null when there is neither. */
export function deliveryHeadline(options: DeliveryPromise['options']): string | null {
  const delivery = options.filter((o) => o.kind !== 'pickup');
  const parts: string[] = [];
  if (delivery.length) {
    parts.push(delivery.some((o) => o.label === 'Delivery across Nigeria') ? 'Delivery across Nigeria' : 'Delivery to selected areas');
  }
  if (options.some((o) => o.kind === 'pickup')) parts.push('Collect in store');
  return parts.length ? parts.join(' · ') : null;
}

/** The ways to pay this store's checkout offers, in its own order and words. */
export function paymentHeadline(methods: PaymentMethodOption[]): string | null {
  const labels = methods
    .filter((m) => m.enabled)
    .map((m) => (m.provider === 'squad' ? 'Pay online securely with Squad' : m.label));
  return labels.length ? labels.join(' · ') : null;
}
