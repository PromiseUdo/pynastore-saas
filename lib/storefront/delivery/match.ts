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
 *   1. a CITIES zone listing the neighbourhood they picked in their LGA
 *   2. a CITIES zone in the shopper's state covering their whole LGA
 *   3. a STATES zone listing their state
 *   4. the NATIONWIDE zone
 *
 * NEIGHBOURHOODS (ROADMAP 25.2). A zone with one LGA may name the
 * neighbourhoods its price covers ("Bode Thomas, Ojuelegba" in Surulere).
 * It matches only a shopper who picked one of them — from the shop's own
 * list (`neighbourhoodsIn`), so the names agree — and a shopper who picked
 * none, or "somewhere else", falls through to the whole-LGA zone.
 *
 * BY LGA (ROADMAP 25.1). Zones list LGAs and shoppers pick theirs from the
 * same official list (lib/geo/nigeria-lgas.ts), so they can't miss each
 * other over a spelling. Names typed before the list existed — a zone's
 * "Bode thomas, ojuelegba", an address's "Lekki" — are read as the LGA
 * they're in (`findLga`), so an older zone covers that whole LGA and an
 * older address still finds its price; a name that isn't an LGA or a known
 * place in one still matches only itself, exactly as before.
 *
 * so "Within Port Harcourt" beats "Rivers", which beats "Rest of Nigeria" —
 * the merchant sets a cheaper local price without it leaking to the rest of
 * the state. Where two zones at the same level both match (the admin refuses
 * to save that, but data can predate a rule), the first in sort order wins.
 *
 * Every active pickup location is offered too, wherever the shopper lives.
 *
 * PER STORE (ROADMAP Phase 9.2). Zones and pickups belong to the store a
 * parcel leaves from, so all of the above runs over ONE store's setup
 * (`quoteFromSetup`). `quoteEachStore` asks every store; which store sends
 * an order, and so which store's prices it pays, is ./plan.ts.
 *
 * Money is minor units (kobo) here, like the rest of the storefront.
 */
import { normalizePlace } from '@/lib/geo/nigeria';
import { findLga } from '@/lib/geo/nigeria-lgas';
import type { Money, ShippingMethod } from '../types';
import { eta, formatEta, type DeliveryEta, type DeliveryEtaUnit } from './eta';

export type ZoneKind = 'CITIES' | 'STATES' | 'NATIONWIDE';

/** Who an option is offered to (ROADMAP 21.4A). Absent = everyone. */
export type DeliveryAudience = 'EVERYONE' | 'RETAIL' | 'TRADE';

/** Whom a quote is for: an approved trade buyer, or anyone else. */
export type DeliveryBuyer = 'retail' | 'trade';

export interface ZoneSetup {
  id: string;
  name: string;
  kind: ZoneKind;
  state: string | null;
  states: string[];
  cities: string[];
  /** neighbourhoods inside its one LGA (25.2); empty or absent = the whole LGA */
  areas?: string[];
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
  /** a trade buyer's own free-delivery threshold (21.4A); null/absent = `freeOver` */
  tradeFreeOver?: Money | null;
  audience?: DeliveryAudience;
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
  audience?: DeliveryAudience;
  isActive: boolean;
}

/** One store's delivery: where it sends to, at what price, and where it can be collected. */
export interface DeliverySetup {
  /** in the merchant's sort order */
  zones: ZoneSetup[];
  pickups: PickupSetup[];
}

/** A store's offer of "delivery to be arranged" for big trade orders (ROADMAP 21.4B). Minor units. */
export interface ArrangedDeliverySetup {
  /** offered from this much of goods; null = not by value */
  fromValue: Money | null;
  /** offered from this many items; null = not by count */
  fromItems: number | null;
  /** how soon the store promises to price it */
  withinHours: number;
}

/** A store that supplies the online store, with its own delivery setup. */
export interface StoreDeliverySetup extends DeliverySetup {
  warehouseId: string;
  name: string;
  /** null/absent: this store doesn't offer it */
  arranged?: ArrangedDeliverySetup | null;
  /** where the store is (Phase 9.1) — the planner prefers a store in the shopper's state */
  state?: string | null;
}

export interface DeliveryAddress {
  state: string;
  /** the LGA (or, on an older address, the city as typed) */
  city: string;
  /** the neighbourhood picked from the shop's list, if it prices by one (25.2) */
  area?: string | null;
}

export interface DeliveryQuote {
  /** the zone that priced delivery; null when nothing covers the address */
  zone: { id: string; name: string } | null;
  /** delivery rates first (cheapest first), then pickups */
  options: ShippingMethod[];
}

export const RATE_ID_PREFIX = 'rate_';
export const PICKUP_ID_PREFIX = 'pickup_';

/** Is an option for this audience offered to this buyer? */
export function offeredTo(audience: DeliveryAudience | undefined, buyer: DeliveryBuyer): boolean {
  if (!audience || audience === 'EVERYONE') return true;
  return buyer === 'trade' ? audience === 'TRADE' : audience === 'RETAIL';
}

/**
 * A store's delivery as one buyer sees it (ROADMAP 21.4A): options and
 * pickups not offered to them are gone, and a trade buyer's free-delivery
 * threshold is the trade one where the merchant set it. Everything after —
 * matching, planning, the stock hold — runs on this, so there's one price
 * calculation and a shopper never sees a trade-only option, nor the reverse.
 */
export function deliveryFor<T extends DeliverySetup>(setup: T, buyer: DeliveryBuyer): T {
  return {
    ...setup,
    zones: setup.zones.map((zone) => ({
      ...zone,
      rates: zone.rates
        .filter((rate) => offeredTo(rate.audience, buyer))
        .map((rate) => ({
          ...rate,
          freeOver: buyer === 'trade' && rate.tradeFreeOver != null ? rate.tradeFreeOver : rate.freeOver,
        })),
    })),
    pickups: setup.pickups.filter((pickup) => offeredTo(pickup.audience, buyer)),
  };
}

/** Does this zone cover the address, and how specifically (lower = more specific)? */
function specificity(zone: ZoneSetup, address: DeliveryAddress): number | null {
  if (!zone.isActive) return null;
  const state = address.state.trim();

  switch (zone.kind) {
    case 'CITIES': {
      if (!zone.state || zone.state !== state) return null;
      const city = normalizePlace(address.city);
      if (!city) return null;
      // The LGA the shopper picked (or typed, on an older address)…
      const lga = findLga(state, address.city);
      const inLga = Boolean(lga && zone.cities.some((c) => findLga(state, c) === lga));
      // A neighbourhood zone covers only the neighbourhoods it names.
      if (zone.areas?.length) {
        const area = normalizePlace(address.area ?? '');
        return inLga && area && zone.areas.some((a) => normalizePlace(a) === area) ? 0 : null;
      }
      if (inLga) return 1;
      // …or, for a name that's no LGA we know, the name itself, as before.
      return zone.cities.some((c) => normalizePlace(c) === city) ? 1 : null;
    }
    case 'STATES':
      return zone.states.includes(state) ? 2 : null;
    case 'NATIONWIDE':
      return state ? 3 : null;
  }
}

/**
 * The neighbourhoods a shop prices by inside one LGA, across its stores, in
 * the order the merchant listed them — what the shopper picks from (25.2).
 * Empty when the shop prices the whole LGA at one price (the usual case), and
 * then nobody is asked.
 */
export function neighbourhoodsIn(setups: DeliverySetup[], state: string, place: string): string[] {
  const lga = findLga(state, place);
  if (!lga) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const setup of setups) {
    for (const zone of setup.zones) {
      if (!zone.isActive || zone.kind !== 'CITIES' || zone.state !== state || !zone.areas?.length) continue;
      if (!zone.cities.some((c) => findLga(state, c) === lga)) continue;
      for (const area of zone.areas) {
        const key = normalizePlace(area);
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(area);
        }
      }
    }
  }
  return out;
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

/** Whether a store can take any order at all: some active rate somewhere, or a pickup. */
export function hasAnyDelivery(setup: DeliverySetup): boolean {
  return (
    setup.pickups.some((p) => p.isActive) ||
    setup.zones.some((z) => z.isActive && z.rates.some((r) => r.isActive))
  );
}

export interface StoreQuote extends DeliveryQuote {
  store: { id: string; name: string };
}

/** What each store would offer this address — the admin's "check an address" shows all of them. */
export function quoteEachStore(stores: StoreDeliverySetup[], address: DeliveryAddress, subtotal: Money): StoreQuote[] {
  return stores.map((store) => ({
    store: { id: store.warehouseId, name: store.name },
    ...quoteFromSetup(store, address, subtotal),
  }));
}

/* ---------------- delivery to be arranged (ROADMAP 21.4B) ---------------- */

export const ARRANGED_ID_PREFIX = 'arranged_';

/** Does a bag this size qualify? Either amount reached is enough; a store with neither set offers it to nobody. */
export function qualifiesForArranged(arranged: ArrangedDeliverySetup | null | undefined, bag: { value: Money; items: number }): boolean {
  if (!arranged) return false;
  const byValue = arranged.fromValue !== null && arranged.fromValue > 0 && bag.value >= arranged.fromValue;
  const byItems = arranged.fromItems !== null && arranged.fromItems > 0 && bag.items >= arranged.fromItems;
  return byValue || byItems;
}

/** The option itself. No price and no window: the store sets them after. */
export function arrangedOption(storeId: string, withinHours: number): ShippingMethod {
  return {
    id: `${ARRANGED_ID_PREFIX}${storeId}`,
    kind: 'delivery',
    label: 'Delivery to be arranged',
    description: `The store will work out the delivery cost for an order this size and send it to you within ${withinHours} hours. You pay once you’ve seen it.`,
    price: 0,
    regularPrice: 0,
    freeOver: null,
    eta: eta(0, 0, 'DAYS'),
    arranged: { withinHours },
  };
}
