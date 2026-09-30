/*
 * Give a test store somewhere to deliver: one "rest of Nigeria" zone with a
 * single ₦2,500 option. Orders need a delivery option quoted for their
 * address, exactly as checkout does, and a store with no zones offers none.
 *
 * Delivery belongs to a store (ROADMAP Phase 9.2), so every store that sells
 * online at the time of the call gets its own copy — the same thing the 9.2
 * migration does — and a store that sells online but can't deliver would have
 * its stock left out. Call it AFTER creating the stores. Safe to call again:
 * a store that already has a zone keeps it, so a suite that adds a store
 * mid-way calls this once more to give only the new one delivery.
 *
 * Returns the option id checkout would send (`rate_<id>`): the oldest
 * store's, which is the one the interim quote picks when prices tie
 * (quoteAcrossStores). Zones cascade away when the organization is deleted.
 */
import { prisma } from '@/lib/prisma';

export async function giveStoreDelivery(organizationId: string): Promise<string> {
  const stores = await prisma.warehouse.findMany({
    where: { organizationId, sellsOnline: true, status: 'ACTIVE' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!stores.length) throw new Error('giveStoreDelivery: create a store that sells online first');

  const rateIds: string[] = [];
  for (const store of stores) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { warehouseId: store.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { rates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (existing?.rates.length) {
      rateIds.push(existing.rates[0].id);
      continue;
    }
    const zone = await prisma.deliveryZone.create({
      data: {
        organizationId,
        warehouseId: store.id,
        name: 'Nigeria',
        kind: 'NATIONWIDE',
        rates: { create: [{ organizationId, name: 'Standard', price: 2500, minMinutes: 2880, maxMinutes: 5760 }] },
      },
      include: { rates: true },
    });
    rateIds.push(zone.rates[0].id);
  }
  return `rate_${rateIds[0]}`;
}

/**
 * The cheapest delivery checkout would preselect for this bag and address —
 * what a shopper's browser would send. A bag split across stores is chosen
 * per parcel (ROADMAP Phase 9.5), so its id joins each parcel's cheapest
 * option; a suite placing such a bag asks here instead of reusing one
 * store's rate id.
 */
export async function quotedDeliveryId(
  organizationSlug: string,
  address: { state: string; city: string },
  lines: { productId: string; variantId: string; quantity: number }[],
): Promise<string> {
  const { resolveLines } = await import('@/lib/storefront/orders/create');
  const { quoteDelivery } = await import('@/lib/storefront/delivery/quote');
  const items = await resolveLines(organizationSlug, lines);
  if (!items) throw new Error('quotedDeliveryId: the bag no longer resolves');
  const quote = await quoteDelivery(
    organizationSlug,
    address,
    items.map((item) => ({ itemId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice })),
  );
  const { defaultParcelChoice } = await import('@/lib/storefront/delivery/plan');
  const id = defaultParcelChoice(quote.parcels) ?? quote.options.find((o) => o.kind === 'delivery')?.id;
  if (!id) throw new Error(`quotedDeliveryId: no delivery option (${quote.reason})`);
  return id;
}
