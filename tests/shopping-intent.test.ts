import { describe, expect, it } from 'vitest';
import { parseAmount, parseShoppingIntent, type IntentVocabulary } from '@/lib/ai/intent';

/* A miniature stand-in for a tenant's catalogue vocabulary. The real one is
 * built from the store's own categories/brands in lib/storefront/discovery.ts. */
const vocab: IntentVocabulary = {
  categories: [
    { name: 'Fashion & Clothing', path: ['fashion'] },
    { name: 'Shirts', path: ['fashion', 'men', 'shirts'] },
    { name: 'Dresses', path: ['fashion', 'women', 'dresses'] },
    { name: 'Laptops', path: ['electronics', 'computers', 'laptops'] },
    { name: 'Headphones', path: ['electronics', 'audio', 'headphones'] },
  ],
  brands: [
    { name: 'Orbit Audio', slug: 'orbit' },
    { name: 'Pixl', slug: 'pixl' },
  ],
  currencyScale: 100,
  formatMoney: (minor) => `₦${(minor / 100).toLocaleString('en-NG')}`,
};

const labels = (i: ReturnType<typeof parseShoppingIntent>) => i.recognised.map((r) => r.label);

describe('parseAmount', () => {
  it('reads plain, separated and suffixed amounts as minor units', () => {
    expect(parseAmount('50000', 100)).toBe(5_000_000);
    expect(parseAmount('50,000', 100)).toBe(5_000_000);
    expect(parseAmount('80k', 100)).toBe(8_000_000);
    expect(parseAmount('1.2m', 100)).toBe(120_000_000);
  });

  it('ignores the currency symbol, whatever it is', () => {
    expect(parseAmount('₦80k', 100)).toBe(8_000_000);
    expect(parseAmount('$1,200', 100)).toBe(120_000);
    expect(parseAmount('£99', 100)).toBe(9_900);
  });

  it('rejects nonsense', () => {
    expect(parseAmount('', 100)).toBeNull();
    expect(parseAmount('abc', 100)).toBeNull();
    expect(parseAmount('0', 100)).toBeNull();
  });
});

describe('parseShoppingIntent', () => {
  it('extracts an upper budget and keeps the rest as keywords', () => {
    const i = parseShoppingIntent('I need a black sneaker for everyday use under 80k', vocab);
    expect(i.maxPrice).toBe(8_000_000);
    expect(i.query).toContain('black');
    expect(i.query).toContain('sneaker');
    // filler words are dropped
    expect(i.query).not.toContain('need');
    expect(labels(i)).toContain('Under ₦80,000');
  });

  it('maps a catalogue noun to its real category path', () => {
    const i = parseShoppingIntent('a laptop for programming under 1.2m', vocab);
    expect(i.categoryPath).toEqual(['electronics', 'computers', 'laptops']);
    expect(i.maxPrice).toBe(120_000_000);
    expect(i.query).toContain('programming');
  });

  it('prefers the most specific category', () => {
    // "Shirts" is deeper than "Fashion & Clothing" and must win
    const i = parseShoppingIntent('shirts', vocab);
    expect(i.categoryPath).toEqual(['fashion', 'men', 'shirts']);
  });

  it('matches a category across plural/singular drift', () => {
    expect(parseShoppingIntent('a dress for a wedding', vocab).categoryPath).toEqual([
      'fashion',
      'women',
      'dresses',
    ]);
    expect(parseShoppingIntent('headphone', vocab).categoryPath).toEqual([
      'electronics',
      'audio',
      'headphones',
    ]);
  });

  it('reads a range without mistaking it for two single bounds', () => {
    const i = parseShoppingIntent('a laptop between 500k and 1m', vocab);
    expect(i.minPrice).toBe(50_000_000);
    expect(i.maxPrice).toBe(100_000_000);
  });

  it('normalises a reversed range', () => {
    const i = parseShoppingIntent('between 1m and 500k', vocab);
    expect(i.minPrice).toBe(50_000_000);
    expect(i.maxPrice).toBe(100_000_000);
  });

  it('reads a lower bound', () => {
    const i = parseShoppingIntent('headphones over 50k', vocab);
    expect(i.minPrice).toBe(5_000_000);
    expect(i.maxPrice).toBeUndefined();
  });

  it('recognises a tenant brand and records its slug', () => {
    const i = parseShoppingIntent('Orbit Audio headphones under 100k', vocab);
    expect(i.brandSlugs).toEqual(['orbit']);
    expect(i.categoryPath).toEqual(['electronics', 'audio', 'headphones']);
  });

  it('picks up sort hints', () => {
    expect(parseShoppingIntent('cheapest laptop', vocab).sort).toBe('price-asc');
    expect(parseShoppingIntent('best rated headphones', vocab).sort).toBe('rating');
  });

  it('returns an empty intent for empty input', () => {
    const i = parseShoppingIntent('   ', vocab);
    expect(i.recognised).toEqual([]);
    expect(i.query).toBeUndefined();
  });

  it('never invents constraints it did not see', () => {
    const i = parseShoppingIntent('something nice', vocab);
    expect(i.maxPrice).toBeUndefined();
    expect(i.categoryPath).toBeUndefined();
    expect(i.brandSlugs).toBeUndefined();
  });
});
