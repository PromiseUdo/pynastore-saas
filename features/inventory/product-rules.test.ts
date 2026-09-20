import { describe, expect, it } from 'vitest';
import {
  combinationKey,
  compareAtProblem,
  discountPercent,
  guessOptionKind,
  normalizeVariantOptions,
  optionsProblem,
  productReadiness,
  publishBlockers,
  suggestVariantSku,
  variantCombinations,
  variantLabel,
  type VariantOption,
} from './product-rules';

const colour: VariantOption = { name: 'Colour', kind: 'color', values: [{ label: 'Red', swatch: '#cc0000' }, { label: 'Navy Blue' }] };
const size: VariantOption = { name: 'Size', kind: 'size', values: [{ label: 'M' }, { label: 'XL' }] };

describe('variant options', () => {
  it('guesses kinds from names', () => {
    expect(guessOptionKind('Color')).toBe('color');
    expect(guessOptionKind('Colours')).toBe('color');
    expect(guessOptionKind('Size')).toBe('size');
    expect(guessOptionKind('Material')).toBe('select');
  });

  it('reads legacy string[] options, recovering values from variants', () => {
    const options = normalizeVariantOptions(['Size', 'Color'], [
      { Size: 'M', Color: 'Red' },
      { Size: 'L', Color: 'Red' },
    ]);
    expect(options).toEqual([
      { name: 'Size', kind: 'size', values: [{ label: 'M' }, { label: 'L' }] },
      { name: 'Color', kind: 'color', values: [{ label: 'Red' }] },
    ]);
  });

  it('drops invalid swatches when reading', () => {
    const [option] = normalizeVariantOptions([{ name: 'Colour', kind: 'color', values: [{ label: 'Red', swatch: 'red' }] }]);
    expect(option.values[0]).toEqual({ label: 'Red' });
  });

  it('explains problems in plain language', () => {
    expect(optionsProblem([colour, size])).toBeNull();
    expect(optionsProblem([{ ...size, name: '' }])).toMatch(/needs a name/);
    expect(optionsProblem([size, { ...size, name: 'size' }])).toMatch(/twice/);
    expect(optionsProblem([{ ...size, values: [] }])).toMatch(/at least one value/);
    expect(optionsProblem([{ ...size, values: [{ label: 'M' }, { label: 'm' }] }])).toMatch(/appears twice/);
  });

  it('builds every combination in option order', () => {
    const combos = variantCombinations([colour, size]);
    expect(combos).toHaveLength(4);
    expect(combos[0]).toEqual({ Colour: 'Red', Size: 'M' });
    expect(variantCombinations([])).toEqual([]);
  });

  it('keys and labels combinations independent of key order', () => {
    const a = { Size: 'M', Colour: 'Red' };
    const b = { Colour: 'red', Size: 'm' };
    expect(combinationKey(a, [colour, size])).toBe(combinationKey(b, [colour, size]));
    expect(variantLabel(a, [colour, size])).toBe('Red / M');
  });

  it('suggests readable variant SKUs', () => {
    expect(suggestVariantSku('tee-001', { Colour: 'Navy Blue', Size: 'XL' }, [colour, size])).toBe('TEE-001-NAVYBLUE-XL');
  });
});

describe('pricing', () => {
  it('rejects fake discounts', () => {
    expect(compareAtProblem(5000, null)).toBeNull();
    expect(compareAtProblem(5000, 7000)).toBeNull();
    expect(compareAtProblem(5000, 5000)).toMatch(/higher/);
    expect(compareAtProblem(null, 7000)).toMatch(/selling price/);
  });

  it('computes discount percent', () => {
    expect(discountPercent(7500, 10000)).toBe(25);
    expect(discountPercent(10000, 10000)).toBeNull();
  });
});

describe('productReadiness', () => {
  const base = {
    imageCount: 2,
    prices: [5000],
    hasCategory: true,
    categoryVisible: true,
    hasDescription: true,
    onlineStoreCount: 1,
    onlineAvailable: 4,
  };

  it('is fully ready when everything is in place', () => {
    expect(productReadiness(base).every((c) => c.ok)).toBe(true);
  });

  it('blocks publishing only on price and image', () => {
    const checks = productReadiness({ ...base, imageCount: 0, prices: [5000, null], onlineStoreCount: 0, hasDescription: false });
    expect(publishBlockers(checks).map((c) => c.key)).toEqual(['price', 'image']);
    expect(checks.find((c) => c.key === 'stores')?.ok).toBe(false);
  });

  it('does not warn about stock before the product exists', () => {
    const checks = productReadiness({ ...base, onlineAvailable: null });
    expect(checks.find((c) => c.key === 'stock')?.ok).toBe(true);
  });
});
