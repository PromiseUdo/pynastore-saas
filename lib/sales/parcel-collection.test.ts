import { describe, expect, it } from 'vitest';
import { collectionSplit } from './parcel-collection';

const sum = (values: number[]) => Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;

describe('collectionSplit', () => {
  it('gives each courier its parcel’s goods and its own delivery fee', () => {
    // ₦10,000 tote + ₦1,500 from Port Harcourt; ₦8,000 lamp + ₦6,000 from Lagos.
    expect(collectionSplit(25_500, [{ goods: 10_000, fee: 1_500 }, { goods: 8_000, fee: 6_000 }])).toEqual([11_500, 14_000]);
  });

  it('shares a discount the way the goods are shared, never touching a delivery fee', () => {
    // ₦1,800 off an ₦18,000 bag: 10% off each parcel's goods.
    expect(collectionSplit(23_700, [{ goods: 10_000, fee: 1_500 }, { goods: 8_000, fee: 6_000 }])).toEqual([10_500, 13_200]);
  });

  it('always adds up to exactly what the customer owes, the odd kobo going to the biggest parcel', () => {
    const parts = collectionSplit(100, [{ goods: 33.33, fee: 0 }, { goods: 33.33, fee: 0 }, { goods: 33.34, fee: 0 }]);
    expect(sum(parts)).toBe(100);
    const odd = collectionSplit(1_000.01, [{ goods: 500, fee: 0 }, { goods: 499.99, fee: 0.02 }]);
    expect(sum(odd)).toBe(1_000.01);
  });

  it('handles one parcel and none', () => {
    expect(collectionSplit(12_000, [{ goods: 10_000, fee: 2_000 }])).toEqual([12_000]);
    expect(collectionSplit(0, [])).toEqual([]);
  });

  it('puts everything on the first parcel when no goods are priced', () => {
    expect(collectionSplit(3_000, [{ goods: 0, fee: 1_000 }, { goods: 0, fee: 500 }])).toEqual([2_500, 500]);
  });
});
