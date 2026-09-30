/*
 * lib/storefront/delivery/supply.ts
 *
 * Which stores supply the online store — THE one definition, used wherever
 * online stock is counted, shown or held (ROADMAP Phase 9.2):
 *
 *   an open store that sells online AND can get an order to a customer —
 *   at least one switched-on zone with a switched-on option, or a
 *   switched-on pickup point, of its own.
 *
 * A store with no way to send anything can't take an online order without it
 * being priced from someone else's delivery, so its stock is left out. The one
 * exception: when NO store in the business can deliver yet, nothing is left
 * out, because checkout is closed anyway ("Checkout isn't open yet") and
 * turning every product "sold out" would say something untrue about the stock.
 *
 * Written as a static Prisma filter, so the catalogue, the stock hold and the
 * admin all ask the database the same question in the same words.
 */
import type { Prisma } from '@/lib/generated/prisma/client';

/** A zone that offers something, and a pickup point that's on. */
const LIVE_DELIVERY: Prisma.WarehouseWhereInput[] = [
  { deliveryZones: { some: { isActive: true, rates: { some: { isActive: true } } } } },
  { pickupLocations: { some: { isActive: true } } },
];

/** Open and selling online — what the merchant switched on. */
export const SELLS_ONLINE_WHERE = { sellsOnline: true, status: 'ACTIVE' } satisfies Prisma.WarehouseWhereInput;

/** Selling online and able to deliver it (or no store can deliver yet). */
export const ONLINE_SUPPLY_WHERE = {
  ...SELLS_ONLINE_WHERE,
  OR: [
    ...LIVE_DELIVERY,
    { organization: { warehouses: { none: { ...SELLS_ONLINE_WHERE, OR: LIVE_DELIVERY } } } },
  ],
} satisfies Prisma.WarehouseWhereInput;

/** A store that has its own way of sending orders, whatever the rest of the business does. */
export const HAS_LIVE_DELIVERY_WHERE = { OR: LIVE_DELIVERY } satisfies Prisma.WarehouseWhereInput;
