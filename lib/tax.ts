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
 *
 * The one exception (ROADMAP 21.2, decision 8): a shop may quote its
 * WHOLESALE prices before VAT. Then VAT is added to a trade buyer's
 * wholesale lines (`addedVat`), and said beside every such price ("+ VAT").
 * Retail prices never change.
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

/**
 * The VAT to add on top of an amount that doesn't include it, in whole minor
 * units: ₦10,000 at 7.5% adds ₦750.
 */
export function addedVat(amountMinor: number, ratePct: number | null | undefined): number {
  if (!ratePct || ratePct <= 0 || amountMinor <= 0) return 0;
  return Math.round((amountMinor * ratePct) / 100);
}

/**
 * The VAT on a bag whose goods are partly before VAT (`beforeVat`: a trade
 * buyer's wholesale lines at a shop that adds VAT) and partly VAT-inclusive
 * (`inclusive`: everything else). A discount on the whole bag is shared
 * between the two in proportion, so neither part is taxed on money the buyer
 * didn't pay. All minor units.
 */
export function bagVat(input: { beforeVat: number; inclusive: number; discount: number; ratePct: number | null | undefined }): {
  /** VAT added on top — part of the total, beyond the goods */
  added: number;
  /** VAT already inside the prices */
  included: number;
} {
  const goods = input.beforeVat + input.inclusive;
  if (goods <= 0) return { added: 0, included: 0 };
  const discount = Math.min(Math.max(0, input.discount), goods);
  const discountOnBeforeVat = Math.round((discount * input.beforeVat) / goods);
  return {
    added: addedVat(input.beforeVat - discountOnBeforeVat, input.ratePct),
    included: includedVat(input.inclusive - (discount - discountOnBeforeVat), input.ratePct),
  };
}
