/*
 * Give a test store somewhere to deliver: one "rest of Nigeria" zone with a
 * single ₦2,500 option. Orders need a delivery option quoted for their
 * address, exactly as checkout does, and a store with no zones offers none.
 *
 * Returns the option id checkout would send (`rate_<id>`). Zones cascade
 * away when the organization is deleted.
 */
import { prisma } from '@/lib/prisma';

export async function giveStoreDelivery(organizationId: string): Promise<string> {
  const zone = await prisma.deliveryZone.create({
    data: {
      organizationId,
      name: 'Nigeria',
      kind: 'NATIONWIDE',
      rates: { create: [{ organizationId, name: 'Standard', price: 2500, minDays: 2, maxDays: 4 }] },
    },
    include: { rates: true },
  });
  return `rate_${zone.rates[0].id}`;
}
