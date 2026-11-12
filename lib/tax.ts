/*
 * lib/tax.ts
 *
 * VAT (ROADMAP 14.1). Pure, so the storefront, the counter and every receipt
 * work it out the same way.
 *
 * A shop is either VAT registered or not, and a shop that isn't shows no VAT
 * anywhere — a receipt must not state a tax the business doesn't charge. A
 * registered shop's prices INCLUDE VAT: it is worked out from the price and
 * stated ("Includes ₦X VAT"), never added on top, so a shelf price is what
 * the shopper pays.
 */

/** Nigeria's standard rate, as a percentage — the starting value, not a rule. */
export const DEFAULT_VAT_RATE_PCT = 7.5;
export const MAX_VAT_RATE_PCT = 50;

export interface VatSettings {
  registered: boolean;
  /** a percentage: 7.5 = 7.5% */
  ratePct: number;
  vatNumber: string | null;
}

/** What a store's checkout and receipts need: null when it charges no VAT. */
export interface ShopVat {
  ratePct: number;
  vatNumber: string | null;
}

export function shopVat(settings: VatSettings): ShopVat | null {
  return settings.registered && settings.ratePct > 0 ? { ratePct: settings.ratePct, vatNumber: settings.vatNumber } : null;
}

/**
 * The VAT inside an amount whose price already includes it, in whole minor
 * units (kobo): ₦10,750 at 7.5% includes ₦750.
 */
export function includedVat(amountMinor: number, ratePct: number | null | undefined): number {
  if (!ratePct || ratePct <= 0 || amountMinor <= 0) return 0;
  return Math.round((amountMinor * ratePct) / (100 + ratePct));
}
