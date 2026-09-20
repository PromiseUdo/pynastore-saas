import { describe, expect, it } from 'vitest';
import {
  computeTotals,
  discountAmount,
  cartSubtotal,
  cartItemCount,
  DEFAULT_SHIPPING,
  SHIPPING_METHODS,
} from './pricing';
import type { CartItem } from './types';

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 'p1',
    productSlug: 'p1',
    variantId: 'v1',
    name: 'Test',
    brandName: 'Brand',
    imageUrl: '',
    optionSummary: '',
    unitPrice: 1_000_000, // ₦10,000
    compareAtPrice: null,
    quantity: 1,
    maxQuantity: 10,
    currency: 'NGN',
    addedAt: 0,
    ...overrides,
  };
}

describe('cart math', () => {
  it('sums subtotal and item count across lines', () => {
    const items = [item({ quantity: 2 }), item({ variantId: 'v2', unitPrice: 500_000, quantity: 3 })];
    expect(cartSubtotal(items)).toBe(2 * 1_000_000 + 3 * 500_000);
    expect(cartItemCount(items)).toBe(5);
  });

  /* Delivery depends on the address and the merchant's zones, so before an
   * option is chosen a total quotes no delivery at all — and says so — rather
   * than a price nobody set. */
  it('leaves delivery out, and marks it pending, until an option is chosen', () => {
    const t = computeTotals({ items: [item({ quantity: 1 })] });
    expect(t.shipping).toBe(0);
    expect(t.shippingPending).toBe(true);
    expect(t.total).toBe(1_000_000);
  });

  it('charges the chosen option, whatever the size of the order', () => {
    const standard = { id: 'rate_x', label: 'Standard', description: '', price: DEFAULT_SHIPPING, etaDays: [2, 4] as [number, number] };
    for (const quantity of [1, 6, 10]) {
      const t = computeTotals({ items: [item({ quantity })], shippingMethod: standard });
      expect(t.shipping, `quantity ${quantity}`).toBe(DEFAULT_SHIPPING);
      expect(t.shippingPending).toBe(false);
      expect(t.total).toBe(quantity * 1_000_000 + DEFAULT_SHIPPING);
    }
  });
});

describe('discount codes', () => {
  /* The codes themselves belong to the merchant and are checked on the
   * server (lib/storefront/discounts/) — this file only owns the arithmetic
   * once a code has been resolved. */
  const percent = (value: number) => ({ code: 'PCT', label: `${value}% off`, kind: 'percent' as const, value });
  const fixed = (value: number, minSubtotal: number | null = null) => ({
    code: 'FIX',
    label: 'Amount off',
    kind: 'fixed' as const,
    value,
    minSubtotal,
  });

  it('applies a percentage discount to the subtotal', () => {
    const items = [item({ quantity: 2 })]; // ₦20,000
    const t = computeTotals({ items, coupon: percent(10) });
    expect(t.discount).toBe(200_000); // 10%
    expect(t.total).toBe(2_000_000 - 200_000);
  });

  it('never discounts delivery', () => {
    const standard = { id: 'rate_x', label: 'Standard', description: '', price: DEFAULT_SHIPPING, etaDays: [2, 4] as [number, number] };
    const t = computeTotals({ items: [item({ quantity: 10 })], coupon: percent(20), shippingMethod: standard });
    expect(t.discount).toBe(2_000_000);
    expect(t.shipping).toBe(DEFAULT_SHIPPING);
  });

  it('a fixed code only applies over its minimum spend', () => {
    const coupon = fixed(500_000, 4_000_000);
    expect(computeTotals({ items: [item({ quantity: 3 })], coupon }).discount).toBe(0); // ₦30k
    expect(computeTotals({ items: [item({ quantity: 5 })], coupon }).discount).toBe(500_000); // ₦50k
  });

  it('never takes off more than the goods are worth', () => {
    expect(discountAmount(fixed(9_000_000), 1_000_000)).toBe(1_000_000);
    expect(computeTotals({ items: [item()], coupon: fixed(9_000_000) }).total).toBe(0);
  });

  it('is nothing at all without a code', () => {
    expect(discountAmount(null, 1_000_000)).toBe(0);
  });

  it('a chosen shipping method sets the delivery price', () => {
    const express = SHIPPING_METHODS.find((m) => m.id === 'express')!;
    const t = computeTotals({ items: [item({ quantity: 10 })], shippingMethod: express });
    expect(t.shipping).toBe(express.price);
  });
});
