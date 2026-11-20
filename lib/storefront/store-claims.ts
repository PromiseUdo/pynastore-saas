/*
 * lib/storefront/store-claims.ts
 *
 * The one-line promises the storefront chrome makes on every page — how
 * orders arrive (utility bar). Pure, and built only from what checkout will
 * actually do for this store: its delivery options (Settings → Delivery and
 * returns). How shoppers can pay is shown as badges, from the same checkout
 * methods (components/storefront/payment/payment-badges.tsx).
 *
 * These used to be fixed copy — "Nationwide delivery in 2–4 working days",
 * "Secure payments by Paystack" — on every merchant's store, whatever their
 * delivery set-up, and whether or not it could take online payments. A store
 * with nothing to promise now promises nothing.
 */
import type { DeliveryPromise } from './types';

/**
 * The one line that says what delivery costs before anyone has said where
 * they are: the cheapest delivery the store offers anywhere, and whether it
 * reaches the whole country. Null when the store delivers nowhere (it may
 * still offer collection).
 *
 * A "from" price, never a table: which store an item leaves from and what
 * that trip costs depend on the item and the address (ROADMAP Phase 9), so
 * every store's zone listed side by side shows prices that don't apply —
 * "Free within Port Harcourt" above an item that ships from Lagos.
 */
export function deliverySummary(options: DeliveryPromise['options']): DeliverySummary | null {
  const delivery = options.filter((o) => o.kind !== 'pickup');
  if (!delivery.length) return null;
  const from = Math.min(...delivery.map((o) => (o.free ? 0 : o.price)));
  return { from, free: from === 0, nationwide: delivery.some((o) => o.nationwide) };
}

export interface DeliverySummary {
  /** the cheapest delivery anywhere, minor units */
  from: number;
  free: boolean;
  /** some store delivers to the whole country */
  nationwide: boolean;
}

/** "Delivery across Nigeria · Collect in store", or null when there is neither. */
export function deliveryHeadline(options: DeliveryPromise['options']): string | null {
  const summary = deliverySummary(options);
  const parts: string[] = [];
  if (summary) {
    // By the zone's kind, not its label — a store with several delivering stores says "… from Lagos Store".
    parts.push(summary.nationwide ? 'Delivery across Nigeria' : 'Delivery to selected areas');
  }
  if (options.some((o) => o.kind === 'pickup')) parts.push('Collect in store');
  return parts.length ? parts.join(' · ') : null;
}
