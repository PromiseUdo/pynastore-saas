import { describe, expect, it } from 'vitest';
import {
  customerCanCancel,
  paymentStatusAfterRefund,
  refundableAmount,
  returnDeadline,
  returnEligibility,
  suggestedReturnRefund,
  validateReturnLines,
} from './policy';

const DELIVERED = new Date('2026-09-01T12:00:00Z');
const day = (n: number) => new Date(DELIVERED.getTime() + n * 86_400_000);
const lines = [
  { id: 'a', quantity: 2, returned: 0 },
  { id: 'b', quantity: 1, returned: 0 },
];

describe('cancelling', () => {
  it('is the shopper’s until the store starts packing', () => {
    expect(customerCanCancel('PENDING')).toBe(true);
    expect(customerCanCancel('CONFIRMED')).toBe(true);
    for (const status of ['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']) {
      expect(customerCanCancel(status)).toBe(false);
    }
  });
});

describe('the return window', () => {
  it('is closed for a store that hasn’t set one — no promise, no button', () => {
    expect(returnDeadline(DELIVERED, null)).toBeNull();
    const result = returnEligibility({ status: 'DELIVERED', deliveredAt: DELIVERED, windowDays: null, lines, now: day(1) });
    expect(result).toEqual({ ok: false, reason: 'no-returns' });
  });

  it('opens on delivery, not before', () => {
    const result = returnEligibility({ status: 'SHIPPED', deliveredAt: null, windowDays: 14, lines, now: day(1) });
    expect(result).toEqual({ ok: false, reason: 'not-delivered' });
  });

  it('runs for exactly the store’s number of days from delivery', () => {
    expect(returnDeadline(DELIVERED, 14)?.toISOString()).toBe(day(14).toISOString());

    const inside = returnEligibility({ status: 'DELIVERED', deliveredAt: DELIVERED, windowDays: 14, lines, now: day(14) });
    expect(inside.ok).toBe(true);

    const after = returnEligibility({
      status: 'DELIVERED',
      deliveredAt: DELIVERED,
      windowDays: 14,
      lines,
      now: new Date(day(14).getTime() + 1),
    });
    expect(after).toEqual({ ok: false, reason: 'window-closed' });
  });

  it('offers only what hasn’t already gone into a return', () => {
    const result = returnEligibility({
      status: 'DELIVERED',
      deliveredAt: DELIVERED,
      windowDays: 30,
      lines: [
        { id: 'a', quantity: 2, returned: 1 },
        { id: 'b', quantity: 1, returned: 1 },
      ],
      now: day(2),
    });
    expect(result.ok && Object.fromEntries(result.remaining)).toEqual({ a: 1 });

    const none = returnEligibility({
      status: 'DELIVERED',
      deliveredAt: DELIVERED,
      windowDays: 30,
      lines: [{ id: 'a', quantity: 1, returned: 1 }],
      now: day(2),
    });
    expect(none).toEqual({ ok: false, reason: 'nothing-left' });
  });
});

describe('what the shopper asks to send back', () => {
  const remaining = new Map([
    ['a', 2],
    ['b', 1],
  ]);

  it('drops zero lines and merges repeats', () => {
    const result = validateReturnLines(
      [
        { orderLineItemId: 'a', quantity: 1 },
        { orderLineItemId: 'b', quantity: 0 },
        { orderLineItemId: 'a', quantity: 1 },
      ],
      remaining,
    );
    expect(result).toEqual({ ok: true, lines: [{ orderLineItemId: 'a', quantity: 2 }] });
  });

  it('refuses nothing, too much, fractions and lines from another order', () => {
    expect(validateReturnLines([{ orderLineItemId: 'a', quantity: 0 }], remaining).ok).toBe(false);
    expect(validateReturnLines([{ orderLineItemId: 'b', quantity: 2 }], remaining).ok).toBe(false);
    expect(validateReturnLines([{ orderLineItemId: 'a', quantity: 1.5 }], remaining).ok).toBe(false);
    expect(validateReturnLines([{ orderLineItemId: 'a', quantity: -1 }], remaining).ok).toBe(false);
    expect(validateReturnLines([{ orderLineItemId: 'zzz', quantity: 1 }], remaining).ok).toBe(false);
  });
});

describe('refunds', () => {
  it('can only give back money that was actually received, and never twice', () => {
    expect(refundableAmount({ paymentStatus: 'PAID', total: 12500, refunded: 0 })).toBe(12500);
    expect(refundableAmount({ paymentStatus: 'PARTIALLY_REFUNDED', total: 12500, refunded: 2500.5 })).toBe(9999.5);
    expect(refundableAmount({ paymentStatus: 'REFUNDED', total: 12500, refunded: 12500 })).toBe(0);
    expect(refundableAmount({ paymentStatus: 'DUE_ON_DELIVERY', total: 12500, refunded: 0 })).toBe(0);
    expect(refundableAmount({ paymentStatus: 'AWAITING_PAYMENT', total: 12500, refunded: 0 })).toBe(0);
  });

  it('marks the order refunded once everything has gone back — not a kobo sooner', () => {
    expect(paymentStatusAfterRefund(100.1, 100.09)).toBe('PARTIALLY_REFUNDED');
    expect(paymentStatusAfterRefund(100.1, 100.1)).toBe('REFUNDED');
    // float noise can't strand an order as "partly" refunded
    expect(paymentStatusAfterRefund(0.3, 0.1 + 0.2)).toBe('REFUNDED');
  });

  it('suggests the returned lines’ value less their share of the discount', () => {
    // ₦10,000 of goods with ₦1,000 off; returning ₦5,000 of it carries ₦500 of the discount.
    expect(
      suggestedReturnRefund({ subtotal: 10000, discount: 1000, lines: [{ unitPrice: 2500, quantity: 2 }] }),
    ).toBe(4500);
    expect(suggestedReturnRefund({ subtotal: 10000, discount: 0, lines: [{ unitPrice: 2500, quantity: 1 }] })).toBe(2500);
  });
});
