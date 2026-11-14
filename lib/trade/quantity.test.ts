import { describe, expect, it } from 'vitest';
import { cleanRules, describeRules, firstTradeQuantity, snapToPacks, tradeBagProblems } from './quantity';
import { lineQuantity, MAX_LINE_QUANTITY } from '@/lib/storefront/cart';

const line = (overrides: Partial<Parameters<typeof tradeBagProblems>[0][number]> = {}) => ({
  productId: 'tee',
  variantId: 'red',
  name: 'Tee',
  optionSummary: 'Red',
  quantity: 24,
  maxQuantity: 500,
  unitPrice: 350_000,
  currency: 'NGN',
  trade: { minQuantity: 12, packSize: 12 },
  ...overrides,
});

describe('the rules themselves', () => {
  it('treats 1 as no rule', () => {
    expect(cleanRules(1, 1)).toEqual({ minQuantity: null, packSize: null });
    expect(cleanRules(12, 24)).toEqual({ minQuantity: 12, packSize: 24 });
  });

  it('starts a buyer at the minimum, in whole packs', () => {
    expect(firstTradeQuantity({ minQuantity: 30, packSize: 24 })).toBe(48);
    expect(firstTradeQuantity({ minQuantity: null, packSize: 24 })).toBe(24);
    expect(firstTradeQuantity({ minQuantity: 12, packSize: null })).toBe(12);
    expect(firstTradeQuantity(undefined)).toBe(1);
  });

  it('rounds a quantity up to whole packs, within stock', () => {
    expect(snapToPacks(25, { minQuantity: null, packSize: 24 }, 500)).toBe(48);
    expect(snapToPacks(60, { minQuantity: null, packSize: 24 }, 50)).toBe(48);
  });

  it('says the rules in words', () => {
    expect(describeRules({ minQuantity: 12, packSize: 24 })).toBe('Minimum 12 · in packs of 24');
    expect(describeRules({ minQuantity: null, packSize: 6 })).toBe('In packs of 6');
    expect(describeRules({ minQuantity: null, packSize: null })).toBeNull();
  });
});

describe('a trade buyer’s bag', () => {
  it('is fine when every rule is met', () => {
    expect(tradeBagProblems([line()], 50_000_00)).toEqual([]);
  });

  it('counts a product’s minimum across its variants', () => {
    const mixed = [line({ quantity: 6, trade: { minQuantity: 12, packSize: null } }), line({ variantId: 'navy', optionSummary: 'Navy', quantity: 6, trade: { minQuantity: 12, packSize: null } })];
    expect(tradeBagProblems(mixed, null)).toEqual([]);
    expect(tradeBagProblems([mixed[0]], null)[0].message).toBe('Tee: order at least 12 (you have 6).');
  });

  it('wants whole packs, line by line', () => {
    expect(tradeBagProblems([line({ quantity: 30 })], null)[0].message).toContain('packs of 12');
    expect(tradeBagProblems([line({ maxQuantity: 5 })], null)[0].message).toContain('aren’t enough in stock for a pack');
  });

  it('holds the shop’s minimum order on the goods', () => {
    const [problem] = tradeBagProblems([line({ quantity: 12, unitPrice: 100_000 })], 2_000_000);
    expect(problem.message).toBe('Trade orders start at ₦20,000 of goods. Add ₦8,000 more to order.');
  });

  it('asks nothing of a shopper’s bag', () => {
    expect(tradeBagProblems([line({ trade: undefined, quantity: 1 })], 2_000_000)).toEqual([]);
  });
});

describe('a line’s quantity', () => {
  it('stops a shopper at 99, but not a trade buyer', () => {
    expect(lineQuantity({ maxQuantity: 5000 }, 500)).toBe(MAX_LINE_QUANTITY);
    expect(lineQuantity({ maxQuantity: 5000, trade: { minQuantity: null, packSize: null } }, 500)).toBe(500);
  });

  it('keeps a trade line in whole packs and within stock', () => {
    const trade = { minQuantity: null, packSize: 24 };
    expect(lineQuantity({ maxQuantity: 5000, trade }, 30)).toBe(48);
    expect(lineQuantity({ maxQuantity: 100, trade }, 200)).toBe(96);
  });
});
