/*
 * lib/storefront/data/campaign-prices.ts
 *
 * The sale prices in force right now, for one store.
 *
 * This is what makes a campaign real rather than a banner: the catalogue is
 * built with these, so the price a shopper is SHOWN and the price they are
 * CHARGED come from the same place. Checkout re-resolves its lines through
 * the catalogue (lib/storefront/orders/create.ts), so there is no second
 * implementation that could disagree.
 *
 * A campaign is live when the clock is inside its window — nothing has to be
 * flipped on time, which means nothing can fail to flip. The catalogue is
 * memoised per request only, so a sale starts and ends on the next request.
 *
 * Server only.
 */
import { prisma } from '@/lib/prisma';
import { bestPrice, type LivePrice } from '@/lib/marketing/campaign-rules';

export interface SalePrice {
  /** major units, as the admin stores them */
  price: number;
  /** what it was selling for when the campaign was scheduled */
  originalPrice: number;
  campaignId: string;
  campaignName: string;
}

/**
 * inventoryItemId → the sale price a shopper should get.
 *
 * Where two live campaigns cover the same product the cheaper wins
 * (`bestPrice`) — any other rule means showing one price and charging
 * another, or letting creation order decide what someone pays.
 */
export async function loadLiveCampaignPrices(
  organizationId: string,
  now: Date = new Date(),
): Promise<Map<string, SalePrice>> {
  const rows = await prisma.campaignPrice.findMany({
    where: {
      organizationId,
      campaign: {
        status: 'SCHEDULED',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
    },
    select: {
      inventoryItemId: true,
      price: true,
      originalPrice: true,
      campaignId: true,
      campaign: { select: { name: true } },
    },
  });

  type Entry = { candidates: LivePrice[]; names: Map<string, string> };
  const byItem = new Map<string, Entry>();
  for (const row of rows) {
    const entry: Entry = byItem.get(row.inventoryItemId) ?? { candidates: [], names: new Map() };
    entry.candidates.push({
      campaignId: row.campaignId,
      price: Number(row.price),
      originalPrice: Number(row.originalPrice),
    });
    entry.names.set(row.campaignId, row.campaign.name);
    byItem.set(row.inventoryItemId, entry);
  }

  const result = new Map<string, SalePrice>();
  for (const [itemId, entry] of byItem) {
    const winner = bestPrice(entry.candidates);
    if (!winner) continue;
    result.set(itemId, {
      price: winner.price,
      originalPrice: winner.originalPrice,
      campaignId: winner.campaignId,
      campaignName: entry.names.get(winner.campaignId) ?? '',
    });
  }

  return result;
}
