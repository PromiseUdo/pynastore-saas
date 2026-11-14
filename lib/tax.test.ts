/*
 * VAT (ROADMAP 14.1): a shop that isn't registered has none; a registered
 * one's prices include it, so it is worked out from the price, never added.
 */
import { describe, expect, it } from 'vitest';
import { includedVat, shopVat, addedVat, bagVat } from './tax';

describe('includedVat', () => {
  it('is the VAT already inside a price', () => {
    expect(includedVat(1_075_000, 7.5)).toBe(75_000); // ₦10,750 includes ₦750
    expect(includedVat(1_000_000, 7.5)).toBe(69_767);
  });

  it('is nothing without a rate or an amount', () => {
    expect(includedVat(1_000_000, null)).toBe(0);
    expect(includedVat(1_000_000, 0)).toBe(0);
    expect(includedVat(0, 7.5)).toBe(0);
  });
});

describe('shopVat', () => {
  it('is null until the shop is VAT registered', () => {
    expect(shopVat({ registered: false, ratePct: 7.5, vatNumber: 'V1' })).toBeNull();
    expect(shopVat({ registered: true, ratePct: 7.5, vatNumber: 'V1' })).toEqual({ ratePct: 7.5, vatNumber: 'V1' });
  });
});

describe('VAT added to wholesale prices (ROADMAP 21.2)', () => {
  it('adds VAT on top of an amount that is before VAT', () => {
    expect(addedVat(1_000_000, 7.5)).toBe(75_000);
    expect(addedVat(1_000_000, null)).toBe(0);
  });

  it('adds VAT to the wholesale part of a bag and states the rest as included', () => {
    // ₦10,000 wholesale (before VAT) + ₦10,750 retail (VAT inside), no discount.
    expect(bagVat({ beforeVat: 1_000_000, inclusive: 1_075_000, discount: 0, ratePct: 7.5 })).toEqual({ added: 75_000, included: 75_000 });
  });

  it('shares a discount between the two parts, so neither is taxed on money not paid', () => {
    // Half the bag each; a ₦2,000 discount takes ₦1,000 off each part.
    const vat = bagVat({ beforeVat: 1_000_000, inclusive: 1_000_000, discount: 200_000, ratePct: 7.5 });
    expect(vat.added).toBe(addedVat(900_000, 7.5));
    expect(vat.included).toBe(includedVat(900_000, 7.5));
  });

  it('is exactly the old rule when nothing is wholesale', () => {
    expect(bagVat({ beforeVat: 0, inclusive: 1_075_000, discount: 75_000, ratePct: 7.5 })).toEqual({ added: 0, included: includedVat(1_000_000, 7.5) });
  });
});
