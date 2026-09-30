/*
 * lib/storefront/delivery/estimate.ts
 *
 * "Ships from Lagos Store · ₦4,500 to Port Harcourt" — what one product would
 * cost to deliver to a place, before anyone reaches checkout (ROADMAP 9.8).
 *
 * Server only. It is checkout's own answer for a bag of one: the item is
 * re-priced from the catalogue (../orders/create.ts resolveLines) and planned
 * by the same planner (./quote.ts → ./plan.ts), so the product page can't
 * promise a store, a price or a window that checkout then contradicts. It is
 * still an estimate — the real bag and address decide at checkout, and the
 * product page says so.
 */
import { isNigerianState } from '@/lib/geo/nigeria';
import { resolveLines } from '../orders/create';
import type { DeliveryEta } from './eta';
import { quoteDelivery } from './quote';

export interface DeliverTo {
  state: string;
  city: string;
}

export interface DeliveryEstimate {
  /** the store it would ship from (or be gathered at) */
  storeName: string;
  /** the cheapest way to get it there */
  cheapest: { label: string; price: number; eta: DeliveryEta };
  /** more than one delivery option is offered */
  moreOptions: boolean;
  /** stores it could be collected from instead */
  pickupCount: number;
}

export type EstimateResult =
  | { ok: true; estimate: DeliveryEstimate }
  /** `unavailable`: the item can't be bought right now; the other two are about the place */
  | { ok: false; reason: 'no-delivery' | 'not-in-stock-here' | 'unavailable' | 'pickup-only'; pickupCount: number };

/** A place a shopper typed or picked, cleaned — null if it isn't one we can quote for. */
export function cleanDeliverTo(input: { state?: unknown; city?: unknown } | null | undefined): DeliverTo | null {
  const state = String(input?.state ?? '').trim();
  const city = String(input?.city ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return isNigerianState(state) ? { state, city } : null;
}

export async function estimateDelivery(
  organizationSlug: string,
  item: { productId: string; variantId: string },
  to: DeliverTo,
): Promise<EstimateResult> {
  const items = await resolveLines(organizationSlug, [{ productId: item.productId, variantId: item.variantId, quantity: 1 }]);
  if (!items) return { ok: false, reason: 'unavailable', pickupCount: 0 };

  const quote = await quoteDelivery(
    organizationSlug,
    to,
    items.map((line) => ({ itemId: line.variantId, quantity: 1, unitPrice: line.unitPrice })),
  );
  const pickupCount = quote.options.filter((o) => o.kind === 'pickup').length;
  // One unit always comes from one store — one parcel, whose options are the delivery ones.
  const [parcel] = quote.parcels;
  const cheapest = parcel?.options[0];
  if (!parcel || !cheapest) {
    return { ok: false, reason: pickupCount ? 'pickup-only' : (quote.reason ?? 'no-delivery'), pickupCount };
  }

  return {
    ok: true,
    estimate: {
      storeName: parcel.storeName,
      cheapest: { label: cheapest.label, price: cheapest.price, eta: cheapest.eta },
      moreOptions: parcel.options.length > 1,
      pickupCount,
    },
  };
}
