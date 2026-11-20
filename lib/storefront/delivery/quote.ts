/*
 * lib/storefront/delivery/quote.ts
 *
 * A store's delivery setup, read once per request, and what it offers.
 * Server only — pages, the checkout action and order placement call this;
 * the matching itself is ./match.ts.
 *
 * Delivery belongs to the store a parcel leaves from (ROADMAP Phase 9.2), so
 * the setup is a list: every store that supplies the online store
 * (./supply.ts), each with its own zones and pickups. A zone or pickup that
 * hasn't been given a store yet is never read, so never offered.
 *
 * Which store sends which part of a bag is ./plan.ts (Phase 9.3): the quote
 * reads each store's stock for the bag and asks the planner, and order
 * placement asks it again and holds stock exactly where the plan says.
 *
 * Money leaves here in MINOR units (kobo); the database keeps major units.
 *
 * Under the demo fixtures (tests, STOREFRONT_FIXTURES=1) the store "delivers
 * nationwide" with the fixture methods, so component tests and demos keep a
 * working checkout without a database.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { useFixtures } from '../data/current';
import { SHIPPING_METHODS } from '../pricing';
import type { DeliveryPromise, Money, ShippingMethod } from '../types';
import { formatEtaSpan } from './eta';
import {
  arrangedOption,
  deliveryFor,
  hasAnyDelivery,
  neighbourhoodsIn,
  qualifiesForArranged,
  type DeliveryAddress,
  type DeliveryBuyer,
  type DeliveryQuote,
  type StoreDeliverySetup,
} from './match';
import { planOrder, type BagLine, type ConsolidationPolicy, type PlannedQuote, type StockByStore } from './plan';
import { ONLINE_SUPPLY_WHERE } from './supply';

const toMinor = (value: { toString(): string } | null): Money | null =>
  value === null ? null : Math.round(Number(value.toString()) * 100);

const FIXTURE_SETUP: StoreDeliverySetup[] = [
  {
    warehouseId: 'demo-store',
    name: 'Main store',
    zones: [
      {
        id: 'demo-nationwide',
        name: 'Nigeria',
        kind: 'NATIONWIDE',
        state: null,
        states: [],
        cities: [],
        isActive: true,
        rates: SHIPPING_METHODS.filter((m) => m.id !== 'pickup').map((m) => ({
          id: m.id,
          name: m.label,
          price: m.price,
          minMinutes: m.eta.minMinutes,
          maxMinutes: m.eta.maxMinutes,
          etaUnit: m.eta.unit,
          freeOver: null,
          isActive: true,
        })),
      },
    ],
    pickups: [],
  },
];

export const loadDeliverySetup = cache(async (organizationSlug: string): Promise<StoreDeliverySetup[]> => {
  if (useFixtures()) return FIXTURE_SETUP;

  const stores = await prisma.warehouse.findMany({
    where: { organization: { slug: organizationSlug, status: 'ACTIVE' }, ...ONLINE_SUPPLY_WHERE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      state: true,
      arrangedDeliveryOn: true,
      arrangedDeliveryFromValue: true,
      arrangedDeliveryFromItems: true,
      arrangedPriceHours: true,
      deliveryZones: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          kind: true,
          state: true,
          states: true,
          cities: true,
          areas: true,
          isActive: true,
          rates: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              name: true,
              price: true,
              minMinutes: true,
              maxMinutes: true,
              etaUnit: true,
              freeOver: true,
              tradeFreeOver: true,
              audience: true,
              isActive: true,
            },
          },
        },
      },
      pickupLocations: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
          instructions: true,
          readyMinutes: true,
          readyUnit: true,
          price: true,
          audience: true,
          isActive: true,
        },
      },
    },
  });

  return stores.map((store) => ({
    warehouseId: store.id,
    name: store.name,
    state: store.state,
    arranged: store.arrangedDeliveryOn
      ? {
          fromValue: toMinor(store.arrangedDeliveryFromValue),
          fromItems: store.arrangedDeliveryFromItems,
          withinHours: store.arrangedPriceHours,
        }
      : null,
    zones: store.deliveryZones.map((zone) => ({
      ...zone,
      rates: zone.rates.map((rate) => ({
        ...rate,
        price: toMinor(rate.price) ?? 0,
        freeOver: toMinor(rate.freeOver),
        tradeFreeOver: toMinor(rate.tradeFreeOver),
      })),
    })),
    pickups: store.pickupLocations.map((pickup) => ({ ...pickup, price: toMinor(pickup.price) ?? 0 })),
  }));
});

/**
 * What each supplying store can sell of these items right now (available =
 * on hand − held), read with the same store filter as the catalogue. Under
 * the demo fixtures the one demo store has whatever is asked for.
 */
export async function loadStockFor(organizationSlug: string, itemIds: string[]): Promise<StockByStore> {
  const ids = [...new Set(itemIds)];
  if (useFixtures()) return { [FIXTURE_SETUP[0].warehouseId]: Object.fromEntries(ids.map((id) => [id, Number.MAX_SAFE_INTEGER])) };
  if (!ids.length) return {};

  const levels = await prisma.inventoryLevel.findMany({
    where: {
      inventoryItemId: { in: ids },
      warehouse: { organization: { slug: organizationSlug, status: 'ACTIVE' }, ...ONLINE_SUPPLY_WHERE },
    },
    select: { warehouseId: true, inventoryItemId: true, quantity: true, reservedQty: true },
  });

  const stock: StockByStore = {};
  for (const level of levels) {
    const units = Math.max(0, Math.floor(Number(level.quantity) - Number(level.reservedQty)));
    (stock[level.warehouseId] ??= {})[level.inventoryItemId] = units;
  }
  return stock;
}

/**
 * The merchant's terms for bringing a split bag together at one store
 * (Phase 9.7), or null when each store sends its own parcel (the default).
 */
export const loadConsolidation = cache(async (organizationSlug: string): Promise<ConsolidationPolicy | null> => {
  if (useFixtures()) return null;
  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { consolidateOrders: true, consolidationFee: true, consolidationLeadMinutes: true, consolidationLeadUnit: true },
  });
  if (!org?.consolidateOrders) return null;
  return { fee: toMinor(org.consolidationFee) ?? 0, leadMinutes: org.consolidationLeadMinutes, leadUnit: org.consolidationLeadUnit };
});

/**
 * The options a shopper at this address gets for this bag, and the plan
 * behind each — which store sends what (./plan.ts). The plans stay on the
 * server: order placement asks again and holds stock where its plan says.
 */
export async function quoteDelivery(
  organizationSlug: string,
  address: DeliveryAddress,
  bag: BagLine[],
  /** an approved trade buyer sees the options offered to trade, at trade thresholds (ROADMAP 21.4A) */
  { buyer = 'retail' }: { buyer?: DeliveryBuyer } = {},
): Promise<PlannedQuote> {
  const [stores, stock, consolidation] = await Promise.all([
    loadDeliverySetup(organizationSlug),
    loadStockFor(organizationSlug, bag.map((line) => line.itemId)),
    loadConsolidation(organizationSlug),
  ]);
  const quote = planOrder(
    stores.map((store) => deliveryFor(store, buyer)),
    stock,
    bag,
    address,
    consolidation,
  );
  return buyer === 'trade' ? withArrangedDelivery(quote, stores, bag) : quote;
}

/**
 * "Delivery to be arranged" (ROADMAP 21.4B), for an approved trade buyer
 * only: offered beside the normal options when the bag goes as ONE parcel
 * from a store that offers it, and is big enough by that store's rule. The
 * planner has already decided where it leaves from — the merchant needs to
 * know where the truck starts — so the option reuses that plan and leaves
 * only the fee open. A bag split across stores isn't offered it: one open
 * fee is something a buyer can agree to; several aren't.
 */
function withArrangedDelivery(quote: PlannedQuote, stores: StoreDeliverySetup[], bag: BagLine[]): PlannedQuote {
  if (quote.parcels.length !== 1) return quote;
  const [parcel] = quote.parcels;
  const store = stores.find((s) => s.warehouseId === parcel.store.id);
  const size = {
    value: bag.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    items: bag.reduce((sum, line) => sum + line.quantity, 0),
  };
  if (!store?.arranged || !qualifiesForArranged(store.arranged, size)) return quote;

  // The plan behind this parcel's delivery — whichever option, the stores and lines are the same.
  const basis = parcel.options.map((o) => quote.plans[o.id]).find(Boolean);
  if (!basis) return quote;
  const option = arrangedOption(store.warehouseId, store.arranged.withinHours);
  const deliveries = quote.options.filter((o) => o.kind !== 'pickup');
  const pickups = quote.options.filter((o) => o.kind === 'pickup');
  return {
    ...quote,
    options: [...deliveries, option, ...pickups],
    plans: {
      ...quote.plans,
      [option.id]: { shipments: basis.shipments.map((shipment) => ({ ...shipment, method: option })) },
    },
  };
}

export async function storeHasDelivery(organizationSlug: string, buyer: DeliveryBuyer = 'retail'): Promise<boolean> {
  return (await loadDeliverySetup(organizationSlug)).some((store) => hasAnyDelivery(deliveryFor(store, buyer)));
}

/**
 * What the store promises before anyone has typed an address: per zone, its
 * cheapest option and delivery window, then each pickup location. Used by
 * the product page, the homepage and the shopping assistant — all of which
 * say the exact price is confirmed at checkout, because it depends on where
 * the order is going.
 *
 * With more than one store sending orders, each promise names its store: the
 * same address can cost a different amount from each.
 */
export async function deliveryOverview(organizationSlug: string): Promise<DeliveryPromise['options']> {
  /* Public: the product page, homepage and assistant are read by anyone, so
   * they promise what a retail shopper gets — never a trade-only option or
   * threshold (ROADMAP 21.4A). */
  const stores = (await loadDeliverySetup(organizationSlug)).map((store) => deliveryFor(store, 'retail'));
  const options: DeliveryPromise['options'] = [];
  const several = stores.filter(hasAnyDelivery).length > 1;

  for (const store of stores) {
    const from = several ? ` from ${store.name}` : '';

    for (const zone of store.zones) {
      const rates = zone.rates.filter((r) => r.isActive);
      if (!zone.isActive || rates.length === 0) continue;
      const cheapest = Math.min(...rates.map((r) => r.price));
      // The window spans every option here: the quickest start, the slowest
      // finish. Each side keeps the unit of the rate it came from.
      const fastest = rates.reduce((a, b) => (b.minMinutes < a.minMinutes ? b : a));
      const slowest = rates.reduce((a, b) => (b.maxMinutes > a.maxMinutes ? b : a));
      const freeOver = rates
        .map((r) => r.freeOver)
        .filter((v): v is Money => v !== null)
        .sort((a, b) => a - b)[0];

      options.push({
        id: `zone_${zone.id}`,
        kind: 'delivery',
        label: (zone.kind === 'NATIONWIDE' ? `Delivery across Nigeria` : `Delivery to ${zone.name}`) + from,
        detail: formatEtaSpan(
          { minutes: fastest.minMinutes, unit: fastest.etaUnit },
          { minutes: slowest.maxMinutes, unit: slowest.etaUnit },
        ),
        price: cheapest,
        free: cheapest === 0,
        fromPrice: rates.length > 1,
        freeOver: freeOver ?? null,
        nationwide: zone.kind === 'NATIONWIDE',
      });
    }

    for (const pickup of store.pickups.filter((p) => p.isActive)) {
      options.push({
        id: `pickup_${pickup.id}`,
        kind: 'pickup',
        label: `Pick up: ${pickup.name}`,
        detail: `${pickup.address}, ${pickup.city}`,
        price: pickup.price,
        free: pickup.price === 0,
        fromPrice: false,
        freeOver: null,
      });
    }
  }

  return options;
}

export type { BagLine, DeliveryQuote, PlannedQuote, ShippingMethod };

/**
 * The neighbourhoods this shop prices by inside an LGA (ROADMAP 25.2) — for
 * the "Which part of Surulere?" question. Empty for nearly every LGA, and
 * then the question isn't asked.
 */
export async function deliveryNeighbourhoods(organizationSlug: string, state: string, lga: string): Promise<string[]> {
  return neighbourhoodsIn(await loadDeliverySetup(organizationSlug), state, lga);
}
