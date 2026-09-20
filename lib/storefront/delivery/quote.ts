/*
 * lib/storefront/delivery/quote.ts
 *
 * A store's delivery setup, read once per request, and what it offers.
 * Server only — pages, the checkout action and order placement call this;
 * the matching itself is ./match.ts.
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
import {
  hasAnyDelivery,
  quoteFromSetup,
  workingDays,
  type DeliveryAddress,
  type DeliveryQuote,
  type DeliverySetup,
} from './match';

const toMinor = (value: { toString(): string } | null): Money | null =>
  value === null ? null : Math.round(Number(value.toString()) * 100);

const FIXTURE_SETUP: DeliverySetup = {
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
        minDays: m.etaDays[0],
        maxDays: m.etaDays[1],
        freeOver: null,
        isActive: true,
      })),
    },
  ],
  pickups: [],
};

export const loadDeliverySetup = cache(async (organizationSlug: string): Promise<DeliverySetup> => {
  if (useFixtures()) return FIXTURE_SETUP;

  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: {
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
            select: { id: true, name: true, price: true, minDays: true, maxDays: true, freeOver: true, isActive: true },
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
          readyInDays: true,
          price: true,
          isActive: true,
        },
      },
    },
  });
  if (!org) return { zones: [], pickups: [] };

  return {
    zones: org.deliveryZones.map((zone) => ({
      ...zone,
      rates: zone.rates.map((rate) => ({
        ...rate,
        price: toMinor(rate.price) ?? 0,
        freeOver: toMinor(rate.freeOver),
      })),
    })),
    pickups: org.pickupLocations.map((pickup) => ({ ...pickup, price: toMinor(pickup.price) ?? 0 })),
  };
});

/** The options a shopper at this address gets, priced for this bag. */
export async function quoteDelivery(
  organizationSlug: string,
  address: DeliveryAddress,
  subtotal: Money,
): Promise<DeliveryQuote> {
  return quoteFromSetup(await loadDeliverySetup(organizationSlug), address, subtotal);
}

export async function storeHasDelivery(organizationSlug: string): Promise<boolean> {
  return hasAnyDelivery(await loadDeliverySetup(organizationSlug));
}

/**
 * What the store promises before anyone has typed an address: per zone, its
 * cheapest option and delivery window, then each pickup location. Used by
 * the product page, the homepage and the shopping assistant — all of which
 * say the exact price is confirmed at checkout, because it depends on where
 * the order is going.
 */
export async function deliveryOverview(organizationSlug: string): Promise<DeliveryPromise['options']> {
  const setup = await loadDeliverySetup(organizationSlug);
  const options: DeliveryPromise['options'] = [];

  for (const zone of setup.zones) {
    const rates = zone.rates.filter((r) => r.isActive);
    if (!zone.isActive || rates.length === 0) continue;
    const cheapest = Math.min(...rates.map((r) => r.price));
    const fastest = Math.min(...rates.map((r) => r.minDays));
    const slowest = Math.max(...rates.map((r) => r.maxDays));
    const freeOver = rates
      .map((r) => r.freeOver)
      .filter((v): v is Money => v !== null)
      .sort((a, b) => a - b)[0];

    options.push({
      id: `zone_${zone.id}`,
      kind: 'delivery',
      label: zone.kind === 'NATIONWIDE' ? `Delivery across Nigeria` : `Delivery to ${zone.name}`,
      detail: workingDays([fastest, slowest]),
      price: cheapest,
      free: cheapest === 0,
      fromPrice: rates.length > 1,
      freeOver: freeOver ?? null,
    });
  }

  for (const pickup of setup.pickups.filter((p) => p.isActive)) {
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

  return options;
}

export type { DeliveryQuote, ShippingMethod };
