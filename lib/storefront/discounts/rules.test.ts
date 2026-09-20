import { describe, expect, it } from 'vitest';
import { checkDiscount, normalizeCode, toAppliedCoupon, type DiscountRecord } from './rules';
import { computeTotals } from '../pricing';
import type { CartItem } from '../types';

const money = (minor: number) => `₦${(minor / 100).toLocaleString('en-NG')}`;
const NOW = new Date('2026-09-17T12:00:00Z');

function code(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id: 'd1',
    code: 'SAVE10',
    label: '10% off',
    kind: 'percent',
    value: 10,
    minSubtotal: null,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    usageCount: 0,
    isActive: true,
    ...overrides,
  };
}

const context = (overrides: Partial<{ subtotal: number; now: Date; customerUses: number }> = {}) => ({
  subtotal: 1_000_000,
  now: NOW,
  customerUses: 0,
  ...overrides,
});

const item = (overrides: Partial<CartItem> = {}): CartItem =>
  ({
    productId: 'p1',
    variantId: 'v1',
    productSlug: 'p',
    name: 'Thing',
    imageUrl: '',
    optionSummary: '',
    unitPrice: 1_000_000,
    compareAtPrice: null,
    quantity: 1,
    maxQuantity: 10,
    currency: 'NGN',
    addedAt: 0,
    ...overrides,
  }) as CartItem;

describe('normalizeCode', () => {
  it('ignores case and stray spaces', () => {
    expect(normalizeCode('  welcome10 ')).toBe('WELCOME10');
    expect(normalizeCode('')).toBe('');
  });
});

describe('checkDiscount', () => {
  it('accepts a live code', () => {
    const result = checkDiscount(code(), context(), money);
    expect(result.ok).toBe(true);
  });

  it('refuses a code that does not exist, or one switched off, with the same words', () => {
    const missing = checkDiscount(null, context(), money);
    const off = checkDiscount(code({ isActive: false }), context(), money);
    expect(missing.ok).toBe(false);
    expect(off.ok).toBe(false);
    // Distinguishing them would let someone learn which codes a store has.
    expect(missing.ok === false && off.ok === false && missing.message === off.message).toBe(true);
  });

  it('refuses a code before it starts and after it ends', () => {
    const early = checkDiscount(code({ startsAt: new Date('2026-10-01') }), context(), money);
    const late = checkDiscount(code({ endsAt: new Date('2026-09-01') }), context(), money);
    expect(early.ok === false && early.reason).toBe('not-started');
    expect(late.ok === false && late.reason).toBe('expired');
  });

  it('refuses a code that has been fully claimed', () => {
    const result = checkDiscount(code({ usageLimit: 50, usageCount: 50 }), context(), money);
    expect(result.ok === false && result.reason).toBe('used-up');
  });

  it('refuses a second use when the code is once per customer', () => {
    const result = checkDiscount(code({ perCustomerLimit: 1 }), context({ customerUses: 1 }), money);
    expect(result.ok === false && result.message).toBe('You’ve already used that code.');
  });

  it('names the minimum spend, because the shopper can act on it', () => {
    const result = checkDiscount(
      code({ minSubtotal: 4_000_000 }),
      context({ subtotal: 3_000_000 }),
      money,
    );
    expect(result.ok === false && result.reason).toBe('below-minimum');
    expect(result.ok === false && result.message).toContain('₦40,000');
  });
});

describe('what a code takes off', () => {
  it('applies a percentage to the goods', () => {
    const totals = computeTotals({ items: [item({ quantity: 2 })], coupon: toAppliedCoupon(code()) });
    expect(totals.discount).toBe(200_000);
  });

  it('takes a fixed amount off, never more than the goods are worth', () => {
    const coupon = toAppliedCoupon(code({ kind: 'fixed', value: 500_000 }));
    expect(computeTotals({ items: [item()], coupon }).discount).toBe(500_000);
    expect(computeTotals({ items: [item({ unitPrice: 300_000 })], coupon }).discount).toBe(300_000);
  });

  it('takes nothing off below the minimum spend', () => {
    const coupon = toAppliedCoupon(code({ kind: 'fixed', value: 500_000, minSubtotal: 4_000_000 }));
    expect(computeTotals({ items: [item({ quantity: 3 })], coupon }).discount).toBe(0);
    expect(computeTotals({ items: [item({ quantity: 5 })], coupon }).discount).toBe(500_000);
  });

  it('never discounts delivery', () => {
    const standard = { id: 's', label: 'Standard', description: '', price: 250_000, etaDays: [2, 4] as [number, number] };
    const totals = computeTotals({
      items: [item()],
      coupon: toAppliedCoupon(code({ value: 100 })),
      shippingMethod: standard,
    });
    expect(totals.discount).toBe(1_000_000);
    expect(totals.total).toBe(250_000);
  });
});
