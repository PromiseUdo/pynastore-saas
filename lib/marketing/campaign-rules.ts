/*
 * lib/marketing/campaign-rules.ts
 *
 * What a campaign is worth, and whether it is running.
 *
 * Pure, so the admin, the storefront and the tests all answer the same way,
 * and so the awkward parts — rounding, overlapping sales, a window that has
 * not opened yet — are pinned by tests rather than by hope.
 */

export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'CANCELLED';
export type CampaignMechanic = 'PERCENT_OFF' | 'FIXED_OFF';

/** What a merchant sees, which includes the two states nothing stores. */
export type CampaignPhase = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

export interface CampaignWindow {
  status: CampaignStatus;
  startsAt: Date;
  endsAt: Date | null;
}

/**
 * Where a campaign is right now.
 *
 * ACTIVE and ENDED are derived from the clock rather than stored, so nothing
 * has to flip them on time — the failure mode of a stored flag is a sale that
 * stays on after it should have stopped, which costs a real shop real money.
 */
export function campaignPhase(campaign: CampaignWindow, now: Date = new Date()): CampaignPhase {
  if (campaign.status === 'CANCELLED') return 'CANCELLED';
  if (campaign.status === 'DRAFT') return 'DRAFT';
  if (now < campaign.startsAt) return 'SCHEDULED';
  if (campaign.endsAt && now >= campaign.endsAt) return 'ENDED';
  return 'ACTIVE';
}

export function isCampaignLive(campaign: CampaignWindow, now: Date = new Date()): boolean {
  return campaignPhase(campaign, now) === 'ACTIVE';
}

/**
 * What a product sells for during a campaign, in major units.
 *
 * Rules that matter to a shop:
 *   - the result is rounded to whole minor units, because a price with three
 *     decimals cannot be charged;
 *   - it never goes below zero — "₦2,000 off" on a ₦1,500 item is free, not
 *     a refund;
 *   - a discount that changes nothing (0%, or an amount the price can't
 *     absorb without already being free) returns null, so the caller can
 *     leave the product out of the sale rather than list it at its usual
 *     price under a "SALE" banner.
 */
export function campaignPriceFor(
  originalPrice: number,
  mechanic: CampaignMechanic,
  value: number,
): number | null {
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) return null;
  if (!Number.isFinite(value) || value <= 0) return null;

  const discounted =
    mechanic === 'PERCENT_OFF'
      ? originalPrice * (1 - Math.min(value, 100) / 100)
      : originalPrice - value;

  const price = Math.max(0, Math.round(discounted * 100) / 100);
  return price < originalPrice ? price : null;
}

/** "20% off" / "₦2,500 off" — the same words everywhere it is described. */
export function campaignMechanicLabel(
  mechanic: CampaignMechanic,
  value: number,
  formatMoney: (amount: number) => string,
): string {
  return mechanic === 'PERCENT_OFF' ? `${value}% off` : `${formatMoney(value)} off`;
}

export interface LivePrice {
  campaignId: string;
  price: number;
  originalPrice: number;
}

/**
 * When two campaigns cover the same product, the shopper pays the LOWER
 * price.
 *
 * Someone has to win, and any other answer means a customer is shown a sale
 * price and charged a higher one — or that the order in which two campaigns
 * happened to be created decides what they pay. Cheapest is the only rule
 * that is defensible out loud.
 */
export function bestPrice(prices: LivePrice[]): LivePrice | null {
  if (prices.length === 0) return null;
  return prices.reduce((best, current) => (current.price < best.price ? current : best));
}
