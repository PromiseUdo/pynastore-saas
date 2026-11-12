/*
 * VAT (ROADMAP 14.1): a shop that isn't registered has none; a registered
 * one's prices include it, so it is worked out from the price, never added.
 */
import { describe, expect, it } from 'vitest';
import { includedVat, shopVat } from './tax';

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
