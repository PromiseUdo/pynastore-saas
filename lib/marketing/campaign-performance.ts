/*
 * lib/marketing/campaign-performance.ts
 *
 * What a campaign's products sold while it was on — shared by the campaign
 * page (its whole window) and the reports hub (the part of the window inside
 * the period being looked at, ROADMAP 14.6), so the two can never disagree.
 *
 * PERFORMANCE IS COMPUTED, NOT STORED. An order counts towards a campaign
 * when it was placed inside the window AND contains a product the campaign
 * priced. `discountGiven` is the gap between the snapshotted original price
 * and what was actually charged — the real cost of the sale.
 *
 * Server only (Prisma); the caller has already checked who is asking and
 * passes the organisation from its context.
 */
import { prisma } from '@/lib/prisma';

export interface CampaignPerformance {
  orders: number;
  revenue: number;
  unitsSold: number;
  discountGiven: number;
  codeRedemptions: number;
}

/**
 * `from` and `to` are both inclusive, as the campaign page has always read
 * its window.
 */
export async function measureCampaign(
  organizationId: string,
  from: Date,
  to: Date,
  priced: { id: string; originalPrice: number }[],
  codeRedemptions: number,
): Promise<CampaignPerformance> {
  if (priced.length === 0 || to < from) {
    return { orders: 0, revenue: 0, unitsSold: 0, discountGiven: 0, codeRedemptions };
  }

  const ids = priced.map((p) => p.id);
  const originalById = new Map(priced.map((p) => [p.id, p.originalPrice]));

  const lines = await prisma.orderLineItem.findMany({
    where: {
      order: {
        organizationId,
        placedAt: { gte: from, lte: to },
        // A cancelled order sold nothing, here as everywhere else.
        status: { not: 'CANCELLED' },
      },
      OR: [{ variantId: { in: ids } }, { AND: [{ variantId: null }, { productId: { in: ids } }] }],
    },
    select: { orderId: true, variantId: true, productId: true, quantity: true, totalPrice: true, unitPrice: true },
  });

  const orders = new Set<string>();
  let revenue = 0;
  let unitsSold = 0;
  let discountGiven = 0;

  for (const line of lines) {
    const itemId = line.variantId ?? line.productId;
    const original = itemId ? originalById.get(itemId) : undefined;
    if (original === undefined) continue;

    orders.add(line.orderId);
    revenue += Number(line.totalPrice);
    unitsSold += line.quantity;
    /* Never negative — a line sold ABOVE its old price (a counter override,
     * say) did not cost the campaign anything. */
    discountGiven += Math.max(0, (original - Number(line.unitPrice)) * line.quantity);
  }

  return { orders: orders.size, revenue, unitsSold, discountGiven, codeRedemptions };
}
