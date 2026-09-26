/*
 * lib/storefront/delivery/match.ts
 *
 * Which delivery options a shopper gets for an address. Pure and
 * client-safe: the server loads a store's setup (./quote.ts) and hands it
 * here, and the admin's "check an address" preview runs the very same code.
 *
 * THE RULE. An address is matched to the most specific active zone covering
 * it, and only that zone's rates are offered:
 *
 *   1. a CITIES zone in the shopper's state listing their city/area
 *   2. a STATES zone listing their state
 *   3. the NATIONWIDE zone
 *
 * so "Within Port Harcourt" beats "Rivers", which beats "Rest of Nigeria" —
 * the merchant sets a cheaper local price without it leaking to the rest of
 * the state. Where two zones at the same level both match (the admin refuses
 * to save that, but data can predate a rule), the first in sort order wins.
 *
 * Every active pickup location is offered too, wherever the shopper lives.
 *
 * Money is minor units (kobo) here, like the rest of the storefront.
 */
import { normalizePlace } from '@/lib/geo/nigeria';
import type { Money, ShippingMethod } from '../types';
import { eta, formatEta, type DeliveryEta, type DeliveryEtaUnit } from './eta';

export type ZoneKind = 'CITIES' | 'STATES' | 'NATIONWIDE';

export interface ZoneSetup {
  id: string;
  name: string;
  kind: ZoneKind;
  state: string | null;
  states: string[];
  cities: string[];
  isActive: boolean;
  rates: RateSetup[];
}

export interface RateSetup {
  id: string;
  name: string;
  price: Money;
  /** delivery time from dispatch, in minutes, said in `etaUnit` */
  minMinutes: number;
  maxMinutes: number;
  etaUnit: DeliveryEtaUnit;
  freeOver: Money | null;
  isActive: boolean;
}

export interface PickupSetup {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  instructions: string | null;
  readyMinutes: number;
  readyUnit: DeliveryEtaUnit;
  price: Money;
  isActive: boolean;
}

export interface DeliverySetup {
  /** in the merchant's sort order */
  zones: ZoneSetup[];
  pickups: PickupSetup[];
}

export interface DeliveryAddress {
  state: string;
  city: string;
}

export interface DeliveryQuote {
  /** the zone that priced delivery; null when nothing covers the address */
  zone: { id: string; name: string } | null;
  /** delivery rates first (cheapest first), then pickups */
  options: ShippingMethod[];
}

export const RATE_ID_PREFIX = 'rate_';
export const PICKUP_ID_PREFIX = 'pickup_';

/** Does this zone cover the address, and how specifically (lower = more specific)? */
function specificity(zone: ZoneSetup, address: DeliveryAddress): number | null {
  if (!zone.isActive) return null;
  const state = address.state.trim();

  switch (zone.kind) {
    case 'CITIES': {
      if (!zone.state || zone.state !== state) return null;
      const city = normalizePlace(address.city);
      if (!city) return null;
      return zone.cities.some((c) => normalizePlace(c) === city) ? 0 : null;
    }
    case 'STATES':
      return zone.states.includes(state) ? 1 : null;
    case 'NATIONWIDE':
      return state ? 2 : null;
  }
}

export function matchZone(setup: DeliverySetup, address: DeliveryAddress): ZoneSetup | null {
  let best: { zone: ZoneSetup; rank: number } | null = null;
  for (const zone of setup.zones) {
    const rank = specificity(zone, address);
    if (rank === null) continue;
    // Strictly better only: at equal rank the earlier zone keeps it.
    if (!best || rank < best.rank) best = { zone, rank };
  }
  return best?.zone ?? null;
}

/** The wording lives in ./eta.ts, so every screen says a window the same way. */
export function etaText(value: DeliveryEta): string {
  return formatEta(value);
}

function rateOption(zone: ZoneSetup, rate: RateSetup, subtotal: Money): ShippingMethod {
  const free = rate.freeOver !== null && subtotal >= rate.freeOver;
  return {
    id: `${RATE_ID_PREFIX}${rate.id}`,
    kind: 'delivery',
    label: rate.name,
    description: `Delivery to ${zone.name}`,
    price: free ? 0 : rate.price,
    regularPrice: rate.price,
    freeOver: rate.freeOver,
    eta: eta(rate.minMinutes, rate.maxMinutes, rate.etaUnit),
  };
}

function pickupOption(pickup: PickupSetup): ShippingMethod {
  return {
    id: `${PICKUP_ID_PREFIX}${pickup.id}`,
    kind: 'pickup',
    label: `Pick up: ${pickup.name}`,
    description: `${pickup.address}, ${pickup.city}, ${pickup.state}`,
    price: pickup.price,
    regularPrice: pickup.price,
    freeOver: null,
    eta: eta(pickup.readyMinutes, pickup.readyMinutes, pickup.readyUnit),
    pickup: {
      name: pickup.name,
      address: pickup.address,
      city: pickup.city,
      state: pickup.state,
      instructions: pickup.instructions,
    },
  };
}

export function quoteFromSetup(
  setup: DeliverySetup,
  address: DeliveryAddress,
  /** the goods' subtotal, for free-delivery thresholds */
  subtotal: Money,
): DeliveryQuote {
  const zone = matchZone(setup, address);

  const delivery = zone
    ? zone.rates
        .filter((rate) => rate.isActive)
        .map((rate) => rateOption(zone, rate, subtotal))
        .sort((a, b) => a.price - b.price || a.eta.minMinutes - b.eta.minMinutes)
    : [];

  const pickups = setup.pickups.filter((p) => p.isActive).map(pickupOption);

  return {
    zone: zone && delivery.length ? { id: zone.id, name: zone.name } : null,
    options: [...delivery, ...pickups],
  };
}

/** Whether the store can take any order at all: some active rate somewhere, or a pickup. */
export function hasAnyDelivery(setup: DeliverySetup): boolean {
  return (
    setup.pickups.some((p) => p.isActive) ||
    setup.zones.some((z) => z.isActive && z.rates.some((r) => r.isActive))
  );
}
