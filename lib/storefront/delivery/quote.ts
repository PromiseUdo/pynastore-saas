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
import { hasAnyDelivery, type DeliveryAddress, type DeliveryQuote, type StoreDeliverySetup } from './match';
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
      deliveryZones: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          kind: true,
          state: true,
          states: true,
          cities: true,
          isActive: true,
          rates: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, name: true, price: true, minMinutes: true, maxMinutes: true, etaUnit: true, freeOver: true, isActive: true },
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
          isActive: true,
        },
      },
    },
  });

  return stores.map((store) => ({
    warehouseId: store.id,
    name: store.name,
    state: store.state,
    zones: store.deliveryZones.map((zone) => ({
      ...zone,
      rates: zone.rates.map((rate) => ({
        ...rate,
        price: toMinor(rate.price) ?? 0,
        freeOver: toMinor(rate.freeOver),
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
export async function quoteDelivery(organizationSlug: string, address: DeliveryAddress, bag: BagLine[]): Promise<PlannedQuote> {
  const [stores, stock, consolidation] = await Promise.all([
    loadDeliverySetup(organizationSlug),
    loadStockFor(organizationSlug, bag.map((line) => line.itemId)),
    loadConsolidation(organizationSlug),
  ]);
  return planOrder(stores, stock, bag, address, consolidation);
}

export async function storeHasDelivery(organizationSlug: string): Promise<boolean> {
  return (await loadDeliverySetup(organizationSlug)).some(hasAnyDelivery);
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
  const stores = await loadDeliverySetup(organizationSlug);
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
