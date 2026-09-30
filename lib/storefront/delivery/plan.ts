/*
 * lib/storefront/delivery/plan.ts
 *
 * Which store sends which part of a bag, and what delivery costs because of
 * it (ROADMAP Phase 9.3). Pure and client-safe: the server loads the stores'
 * delivery setups and their stock (./quote.ts) and hands them here. The
 * checkout quote and order placement run this SAME function, and the stock
 * hold follows the plan it returns — so the store that pays for the trip is
 * the store the goods leave from.
 *
 * THE RULES, in order:
 *
 *   1. One store that has the whole bag AND delivers to the address. If
 *      several do, the one whose cheapest option costs least wins, then one
 *      in the shopper's own state, then the older store.
 *   2. Otherwise the fewest stores that can cover the bag between them, each
 *      line whole from one store where possible (a line is split only when no
 *      single chosen store has enough of it). Among equally few, fewest split
 *      lines, then the cheapest total delivery, then the most stores in the
 *      shopper's state, then the older stores.
 *   3. A store that doesn't deliver to the address is never used for
 *      delivery, whatever it holds.
 *   4. No plan → no delivery options, with the reason, so checkout can say
 *      "we can't deliver everything here" rather than "we don't deliver here".
 *
 * A PICKUP is one store's counter, so it's offered only when that store holds
 * the whole bag, and choosing it sends everything from there.
 *
 * SEVERAL PARCELS (Phase 9.5): a bag split across stores comes back as
 * `parcels`, each with its own options, and the shopper chooses how each one
 * travels. The choice travels as ONE id — each parcel's option id, in parcel
 * order, joined by "+" (`rate_a+rate_b`) — so the form, the checkout store and
 * the order keep a single delivery field. `combineParcelChoice` turns that id
 * into the method the order is charged (the sum of the parcels, the slowest
 * window, the parcels listed); `resolveDeliveryChoice` turns it back into a
 * plan on the server. Both refuse an id that doesn't match the parcels.
 *
 * BROUGHT TOGETHER (Phase 9.7). A merchant may choose, for a bag no single
 * store holds, to bring everything to one store and send ONE parcel instead
 * of several. Then the planner picks the store to gather at — one that
 * delivers to the address, needing the fewest other stores to bring from,
 * then the cheapest in all, then in the shopper's state, then the older —
 * and each of its options costs the merchant's fee for every store items come
 * from on top, and takes the extra time on top. A pickup point may likewise
 * gather the bag. The parcel records where the rest is coming from
 * (`sources`), which is what raises the stock transfers once it's paid.
 *
 * Money is minor units (kobo), like the rest of the storefront.
 */
import type { Money, ShippingMethod } from '../types';
import { eta, MINUTES_PER_UNIT, type DeliveryEta, type DeliveryEtaUnit } from './eta';
import { quoteFromSetup, type DeliveryAddress, type StoreDeliverySetup } from './match';

/** One line of the bag, as re-priced on the server. */
export interface BagLine {
  /** the stocked unit: a variant, or a product without variants */
  itemId: string;
  quantity: number;
  unitPrice: Money;
}

/** What each store can sell right now: warehouseId → itemId → units available. */
export type StockByStore = Record<string, Record<string, number>>;

/** Where a gathering store's items come from (Phase 9.7). */
export interface ParcelSource {
  store: { id: string; name: string };
  lines: { itemId: string; quantity: number }[];
}

/** The merchant's terms for bringing a bag together at one store (Phase 9.7). */
export interface ConsolidationPolicy {
  /** for each store items are brought from, minor units */
  fee: Money;
  /** the extra time, in minutes, and the unit the merchant said it in */
  leadMinutes: number;
  leadUnit: DeliveryEtaUnit;
}

export interface PlannedShipment {
  store: { id: string; name: string };
  /** what this parcel holds; a split line appears in two parcels */
  lines: { itemId: string; quantity: number }[];
  /** brought together: the part of `lines` held at other stores, to be brought here first */
  sources?: ParcelSource[];
  /** the goods in this parcel, for its free-delivery threshold */
  subtotal: Money;
  /** how this parcel travels (or is collected) */
  method: ShippingMethod;
}

export interface FulfilmentPlan {
  shipments: PlannedShipment[];
}

/** Why there's no delivery option for a bag at an address. */
export type NoPlanReason =
  /** no store that sells online delivers to this address */
  | 'no-delivery'
  /** stores deliver here, but between them they don't hold the bag */
  | 'not-in-stock-here';

/** A parcel as checkout offers it: where it comes from, what's in it, how it can travel. */
export interface ParcelOffer {
  storeName: string;
  lines: { itemId: string; quantity: number }[];
  /** this parcel's delivery options, cheapest first */
  options: ShippingMethod[];
}

/** The same, with the store's id — server side only. */
export interface QuoteParcel extends ParcelOffer {
  store: { id: string; name: string };
  subtotal: Money;
  /** brought together (Phase 9.7): what comes from other stores first */
  sources?: ParcelSource[];
}

export interface PlannedQuote {
  /** the zone that priced the biggest parcel; null when nothing delivers */
  zone: { id: string; name: string } | null;
  /**
   * With ONE parcel: its delivery options (cheapest first), then pickups.
   * With several: pickups only — delivery is chosen per parcel (`parcels`).
   */
  options: ShippingMethod[];
  /** the delivery plan's parcels, biggest first; [] when nothing delivers */
  parcels: QuoteParcel[];
  /** option id → the plan behind it; never sent to the browser */
  plans: Record<string, FulfilmentPlan>;
  /** set when there's no delivery option */
  reason: NoPlanReason | null;
}

/** More stores than this in play and only the oldest are considered — keeps the search tiny. */
const MAX_STORES_SEARCHED = 10;

interface Candidate {
  shipments: { store: StoreDeliverySetup; index: number; lines: { itemId: string; quantity: number }[] }[];
  splitLines: number;
}

function mergeBag(bag: BagLine[]): BagLine[] {
  const byItem = new Map<string, BagLine>();
  for (const line of bag) {
    const quantity = Math.floor(line.quantity);
    if (quantity < 1) continue;
    const seen = byItem.get(line.itemId);
    if (seen) seen.quantity += quantity;
    else byItem.set(line.itemId, { ...line, quantity });
  }
  return [...byItem.values()];
}

function available(stock: StockByStore, storeId: string, itemId: string): number {
  return Math.max(0, Math.floor(stock[storeId]?.[itemId] ?? 0));
}

const byPriceThenSpeed = (a: ShippingMethod, b: ShippingMethod) => a.price - b.price || a.eta.minMinutes - b.eta.minMinutes;

/** The whole window of several parcels: it's delivered when the last one arrives. */
function slowest(methods: ShippingMethod[]): DeliveryEta {
  const last = methods.reduce((a, b) => (b.eta.maxMinutes > a.eta.maxMinutes ? b : a));
  return eta(Math.max(...methods.map((m) => m.eta.minMinutes)), last.eta.maxMinutes, last.eta.unit);
}

function listNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function planOrder(
  stores: StoreDeliverySetup[],
  stock: StockByStore,
  bagLines: BagLine[],
  address: DeliveryAddress,
  /** set when the merchant brings a split bag together at one store (Phase 9.7) */
  consolidation: ConsolidationPolicy | null = null,
): PlannedQuote {
  const bag = mergeBag(bagLines);
  const priceOf = new Map(bag.map((line) => [line.itemId, line.unitPrice]));
  const goods = (lines: { itemId: string; quantity: number }[]) =>
    lines.reduce((sum, line) => sum + line.quantity * (priceOf.get(line.itemId) ?? 0), 0);

  const deliveryFrom = (store: StoreDeliverySetup, subtotal: Money) => {
    const quote = quoteFromSetup(store, address, subtotal);
    return { zone: quote.zone, options: quote.options.filter((o) => o.kind === 'delivery').sort(byPriceThenSpeed) };
  };
  const sameState = (store: StoreDeliverySetup) => (store.state && store.state === address.state.trim() ? 1 : 0);

  const deliverers = stores
    .map((store, index) => ({ store, index, cheapest: deliveryFrom(store, 0).options[0]?.price ?? null }))
    .filter((d): d is { store: StoreDeliverySetup; index: number; cheapest: Money } => d.cheapest !== null)
    .slice(0, MAX_STORES_SEARCHED);

  /* ---- the delivery plan ---- */
  let best: { candidate: Candidate; score: number[] } | null = null;

  if (bag.length) {
    for (let k = 1; k <= deliverers.length && !best; k += 1) {
      for (const combo of combinations(deliverers, k)) {
        const candidate = assign(combo, bag, stock, sameState);
        if (!candidate) continue;

        const cost = candidate.shipments.reduce(
          (sum, s) => sum + (deliveryFrom(s.store, goods(s.lines)).options[0]?.price ?? 0),
          0,
        );
        const score = [
          candidate.shipments.length,
          candidate.splitLines,
          cost,
          -candidate.shipments.reduce((n, s) => n + sameState(s.store), 0),
          ...candidate.shipments.map((s) => s.index),
        ];
        if (!best || compare(score, best.score) < 0) best = { candidate, score };
      }
    }
  }

  const options: ShippingMethod[] = [];
  const plans: Record<string, FulfilmentPlan> = {};
  let zone: PlannedQuote['zone'] = null;
  let parcels: QuoteParcel[] = [];

  /* ---- brought together at one store, when the merchant wants that (9.7) ---- */
  const gatherAt = (target: StoreDeliverySetup) => (consolidation ? gather(target, stores, stock, bag) : null);
  const splitNeeded = !best || best.candidate.shipments.length > 1;
  let together: { store: StoreDeliverySetup; sources: ParcelSource[] } | null = null;

  if (consolidation && bag.length && splitNeeded) {
    let bestGather: { store: StoreDeliverySetup; sources: ParcelSource[]; score: number[] } | null = null;
    for (const d of deliverers) {
      const sources = gatherAt(d.store);
      if (!sources) continue;
      const cheapest = deliveryFrom(d.store, goods(bag)).options[0]?.price ?? 0;
      const score = [sources.length, cheapest + consolidation.fee * sources.length, -sameState(d.store), d.index];
      if (!bestGather || compare(score, bestGather.score) < 0) bestGather = { store: d.store, sources, score };
    }
    if (bestGather) together = { store: bestGather.store, sources: bestGather.sources };
  }

  if (together && consolidation) {
    const { store, sources } = together;
    const subtotal = goods(bag);
    const quote = deliveryFrom(store, subtotal);
    const lines = bag.map(({ itemId, quantity }) => ({ itemId, quantity }));
    const offered = quote.options.map((method) => broughtTogether(method, store.name, sources, consolidation));
    zone = quote.zone;
    parcels = [
      { store: { id: store.warehouseId, name: store.name }, storeName: store.name, lines, subtotal, options: offered, sources },
    ];
    for (const method of offered) {
      options.push(method);
      plans[method.id] = { shipments: [{ store: parcels[0].store, lines, subtotal, method, sources }] };
    }
  } else if (best) {
    // The biggest parcel first, as checkout lists them.
    const ranked = best.candidate.shipments
      .map((s) => ({ ...s, subtotal: goods(s.lines) }))
      .sort((a, b) => b.subtotal - a.subtotal || a.index - b.index)
      .map((s) => ({ ...s, ...deliveryFrom(s.store, s.subtotal) }));
    zone = ranked[0].zone;
    parcels = ranked.map((p) => ({
      store: { id: p.store.warehouseId, name: p.store.name },
      storeName: p.store.name,
      lines: p.lines,
      subtotal: p.subtotal,
      options: p.options,
    }));

    // One parcel: its options are simply the bag's options.
    if (parcels.length === 1) {
      const [only] = parcels;
      for (const method of only.options) {
        options.push(method);
        plans[method.id] = { shipments: [{ store: only.store, lines: only.lines, subtotal: only.subtotal, method }] };
      }
    }
  }

  /* ---- pickups: one store's counter, so only where that store has it all —
   * or, when the merchant brings bags together, where it can be gathered ---- */
  const bagSubtotal = goods(bag);
  for (const store of stores) {
    if (!bag.length) break;
    const holdsAll = bag.every((line) => available(stock, store.warehouseId, line.itemId) >= line.quantity);
    const sources = holdsAll ? [] : gatherAt(store);
    if (!sources) continue;
    for (const pickup of quoteFromSetup(store, address, bagSubtotal).options.filter((o) => o.kind === 'pickup')) {
      const method = sources.length && consolidation ? broughtTogether(pickup, store.name, sources, consolidation) : pickup;
      options.push(method);
      plans[method.id] = {
        shipments: [
          {
            store: { id: store.warehouseId, name: store.name },
            lines: bag.map(({ itemId, quantity }) => ({ itemId, quantity })),
            subtotal: bagSubtotal,
            method,
            ...(sources.length ? { sources } : {}),
          },
        ],
      };
    }
  }

  return {
    zone,
    options,
    parcels,
    plans,
    reason: best || together ? null : deliverers.length ? 'not-in-stock-here' : 'no-delivery',
  };
}

/**
 * What a gathering store must be sent, line by line: its own stock first,
 * the rest from the fewest other stores (fullest first). Null when the stores
 * between them can't cover the bag. [] means it already holds everything.
 */
function gather(target: StoreDeliverySetup, stores: StoreDeliverySetup[], stock: StockByStore, bag: BagLine[]): ParcelSource[] | null {
  const bySource = new Map<string, ParcelSource>();
  const others = stores.filter((s) => s.warehouseId !== target.warehouseId);

  for (const line of bag) {
    let remaining = line.quantity - Math.min(line.quantity, available(stock, target.warehouseId, line.itemId));
    if (remaining <= 0) continue;
    // Prefer stores already sending something, then the fullest — fewer transfers.
    const ranked = [...others].sort(
      (a, b) =>
        Number(bySource.has(b.warehouseId)) - Number(bySource.has(a.warehouseId)) ||
        available(stock, b.warehouseId, line.itemId) - available(stock, a.warehouseId, line.itemId),
    );
    for (const source of ranked) {
      const take = Math.min(remaining, available(stock, source.warehouseId, line.itemId));
      if (take <= 0) continue;
      const entry = bySource.get(source.warehouseId) ?? { store: { id: source.warehouseId, name: source.name }, lines: [] };
      entry.lines.push({ itemId: line.itemId, quantity: take });
      bySource.set(source.warehouseId, entry);
      remaining -= take;
      if (remaining === 0) break;
    }
    if (remaining > 0) return null;
  }
  return [...bySource.values()];
}

/** The larger of two units, so "2 hours + 1 day" is said in days. */
function largerUnit(a: DeliveryEtaUnit, b: DeliveryEtaUnit): DeliveryEtaUnit {
  return MINUTES_PER_UNIT[a] >= MINUTES_PER_UNIT[b] ? a : b;
}

/** An option (or pickup) from a gathering store: the fee per store brought from, and the extra time, on top. */
function broughtTogether(
  method: ShippingMethod,
  storeName: string,
  sources: ParcelSource[],
  policy: ConsolidationPolicy,
): ShippingMethod {
  const extra = policy.fee * sources.length;
  const from = listNames(sources.map((s) => s.store.name));
  return {
    ...method,
    // Copied onto the order, so it says the parcel was gathered first.
    label: `${method.label} · brought together`,
    description:
      method.kind === 'pickup'
        ? `${method.description} · items from ${from} are brought here first`
        : `Items from ${from} are brought to ${storeName} first, then sent as one parcel`,
    price: method.price + extra,
    regularPrice: (method.regularPrice ?? method.price) + extra,
    // A threshold would make delivery free but not the fee; one figure would mislead.
    freeOver: null,
    eta: eta(
      method.eta.minMinutes + policy.leadMinutes,
      method.eta.maxMinutes + policy.leadMinutes,
      largerUnit(method.eta.unit, policy.leadUnit),
    ),
    consolidatedFrom: sources.map((s) => s.store.name),
  };
}

/* ---------------- choosing per parcel (client-safe) ---------------- */

export const PARCEL_CHOICE_SEPARATOR = '+';

/** One id for a choice per parcel, in parcel order. */
export function parcelChoiceId(optionIds: string[]): string {
  return optionIds.join(PARCEL_CHOICE_SEPARATOR);
}

/** The option chosen for each parcel, or null if the id doesn't fit these parcels. */
export function parcelChoices(parcels: ParcelOffer[], choiceId: string): ShippingMethod[] | null {
  if (parcels.length < 2) return null;
  const ids = choiceId.split(PARCEL_CHOICE_SEPARATOR);
  if (ids.length !== parcels.length) return null;
  const chosen = ids.map((id, i) => parcels[i].options.find((o) => o.id === id));
  return chosen.every((m): m is ShippingMethod => Boolean(m)) ? chosen : null;
}

/** Every parcel by its cheapest option — what checkout preselects. */
export function defaultParcelChoice(parcels: ParcelOffer[]): string | null {
  if (parcels.length < 2 || parcels.some((p) => !p.options.length)) return null;
  return parcelChoiceId(parcels.map((p) => p.options[0].id));
}

/**
 * The method an order is charged for a choice per parcel: each store's trip
 * added up, delivered when the slowest parcel arrives, with the parcels
 * listed so the review, the order and the emails can show them.
 */
export function combineParcelChoice(parcels: ParcelOffer[], choiceId: string): ShippingMethod | null {
  const chosen = parcelChoices(parcels, choiceId);
  if (!chosen) return null;
  return {
    id: choiceId,
    kind: 'delivery',
    // Copied onto the order, so it says what was chosen and that there's more than one.
    label: `${chosen.map((m) => m.label).join(' + ')} · ${parcels.length} parcels`,
    description: `Sent in ${parcels.length} parcels, from ${listNames(parcels.map((p) => p.storeName))}`,
    price: chosen.reduce((sum, m) => sum + m.price, 0),
    regularPrice: chosen.reduce((sum, m) => sum + (m.regularPrice ?? m.price), 0),
    // Each parcel has its own threshold; one figure here would mislead.
    freeOver: null,
    eta: slowest(chosen),
    parcels: parcels.map((p, i) => ({
      storeName: p.storeName,
      label: chosen[i].label,
      price: chosen[i].price,
      eta: chosen[i].eta,
      itemIds: p.lines.map((l) => l.itemId),
    })),
  };
}

/**
 * The method and plan behind a delivery choice — a single option or pickup,
 * or a choice per parcel. Null when the id isn't on offer for this quote
 * (the address, the rates or the stock changed); the caller refuses it.
 */
export function resolveDeliveryChoice(
  quote: PlannedQuote,
  choiceId: string,
): { method: ShippingMethod; plan: FulfilmentPlan } | null {
  const single = quote.options.find((o) => o.id === choiceId);
  if (single && quote.plans[choiceId]) return { method: single, plan: quote.plans[choiceId] };

  const method = combineParcelChoice(quote.parcels, choiceId);
  const chosen = parcelChoices(quote.parcels, choiceId);
  if (!method || !chosen) return null;
  return {
    method,
    plan: {
      shipments: quote.parcels.map((p, i) => ({ store: p.store, lines: p.lines, subtotal: p.subtotal, method: chosen[i] })),
    },
  };
}

/**
 * Hand each line of the bag to a store in this combination, or null if the
 * combination can't cover it. Whole lines go to the store that's cheapest to
 * send from (then same state, then older); a line is split only when no store
 * in the combination has all of it.
 */
function assign(
  combo: { store: StoreDeliverySetup; index: number; cheapest: Money }[],
  bag: BagLine[],
  stock: StockByStore,
  sameState: (store: StoreDeliverySetup) => number,
): Candidate | null {
  const lines = new Map<number, { itemId: string; quantity: number }[]>();
  const give = (index: number, itemId: string, quantity: number) =>
    lines.set(index, [...(lines.get(index) ?? []), { itemId, quantity }]);
  let splitLines = 0;

  for (const line of bag) {
    const whole = combo
      .filter((c) => available(stock, c.store.warehouseId, line.itemId) >= line.quantity)
      .sort((a, b) => a.cheapest - b.cheapest || sameState(b.store) - sameState(a.store) || a.index - b.index);
    if (whole.length) {
      give(whole[0].index, line.itemId, line.quantity);
      continue;
    }

    // Split, fullest first, so it's split as few ways as possible.
    const fullest = [...combo].sort(
      (a, b) =>
        available(stock, b.store.warehouseId, line.itemId) - available(stock, a.store.warehouseId, line.itemId) ||
        a.index - b.index,
    );
    let remaining = line.quantity;
    for (const c of fullest) {
      const take = Math.min(remaining, available(stock, c.store.warehouseId, line.itemId));
      if (take <= 0) continue;
      give(c.index, line.itemId, take);
      remaining -= take;
      if (remaining === 0) break;
    }
    if (remaining > 0) return null;
    splitLines += 1;
  }

  return {
    splitLines,
    shipments: combo.filter((c) => lines.has(c.index)).map((c) => ({ store: c.store, index: c.index, lines: lines.get(c.index)! })),
  };
}

function* combinations<T>(items: T[], k: number, start = 0, picked: T[] = []): Generator<T[]> {
  if (picked.length === k) {
    yield picked;
    return;
  }
  for (let i = start; i <= items.length - (k - picked.length); i += 1) {
    yield* combinations(items, k, i + 1, [...picked, items[i]]);
  }
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The admin's "check an address": what checkout would offer when every store
 * has the items — so the store chosen is simply the cheapest to send from.
 */
export function planWithAnyStock(stores: StoreDeliverySetup[], address: DeliveryAddress, subtotal: Money): PlannedQuote {
  const stock: StockByStore = Object.fromEntries(stores.map((s) => [s.warehouseId, { any: Number.MAX_SAFE_INTEGER }]));
  return planOrder(stores, stock, [{ itemId: 'any', quantity: 1, unitPrice: subtotal }], address);
}
