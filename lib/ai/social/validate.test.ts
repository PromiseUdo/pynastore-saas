/*
 * Fact-checking what the model wrote.
 *
 * The prompt tells Gemini not to invent prices, discounts, stock, delivery
 * promises or warranties. These tests are about the case where it does it
 * anyway — because a prompt is an instruction and this is the enforcement.
 *
 * The rule under test: a claim survives only if the product's own rows
 * support it.
 */
import { describe, it, expect } from 'vitest';
import { cleanHashtag, cleanHashtags, stripForeignLinks, stripUnsupportedClaims } from './validate';
import type { ProductFacts } from '@/lib/social/product-facts';

const FACTS: ProductFacts = {
  productId: 'p1',
  name: 'Ankara Wrap Dress',
  description: 'A wrap dress cut from cotton Ankara.',
  shortDescription: null,
  categoryPath: ['Clothing', 'Dresses'],
  brandName: 'Adire Studio',
  priceLabel: '₦24,500',
  variantSummary: ['Size: S, M, L'],
  highlights: ['Adjustable waist tie'],
  specs: ['Fabric: 100% cotton'],
  tags: ['ankara'],
  storeName: 'Adire Studio',
  storeDescription: null,
  productUrl: 'https://shop.adire.example.com/products/ankara-wrap-dress',
  isPublished: true,
  images: [],
};

describe('stripUnsupportedClaims', () => {
  it('keeps copy that only says what the record says', () => {
    const text = 'Meet the Ankara Wrap Dress. Cut from 100% cotton, with an adjustable waist tie. ₦24,500.';
    const result = stripUnsupportedClaims(text, FACTS);
    expect(result.text).toBe(text);
    expect(result.removed).toEqual([]);
  });

  it('removes a price we never recorded', () => {
    const result = stripUnsupportedClaims('A lovely dress. Yours for ₦9,999 today.', FACTS);
    expect(result.text).toBe('A lovely dress.');
    expect(result.removed).toContain('a price we haven’t recorded for this product');
  });

  it('keeps the real price however it is punctuated', () => {
    const result = stripUnsupportedClaims('Just ₦24,500.', FACTS);
    expect(result.text).toBe('Just ₦24,500.');
  });

  it('removes an invented discount', () => {
    const result = stripUnsupportedClaims('Beautiful dress. Get 20% off this week.', FACTS);
    expect(result.text).toBe('Beautiful dress.');
    expect(result.removed).toContain('a discount or sale claim');
  });

  it('removes stock and urgency claims', () => {
    for (const claim of ['Only 3 left!', 'Selling fast!', 'Limited stock.', 'Hurry now.']) {
      const result = stripUnsupportedClaims(`A wrap dress. ${claim}`, FACTS);
      expect(result.text).toBe('A wrap dress.');
      expect(result.removed).toContain('a stock or urgency claim');
    }
  });

  it('removes a delivery promise the product never made', () => {
    const result = stripUnsupportedClaims('Cotton Ankara. Free delivery nationwide.', FACTS);
    expect(result.text).toBe('Cotton Ankara.');
    expect(result.removed).toContain('a delivery promise the product doesn’t state');
  });

  it('allows a delivery claim the merchant wrote themselves', () => {
    const withPromise = { ...FACTS, description: 'A wrap dress. Free delivery in Lagos.' };
    const result = stripUnsupportedClaims('A wrap dress with free delivery in Lagos.', withPromise);
    expect(result.text).toContain('free delivery');
  });

  it('removes a warranty nobody offered', () => {
    const result = stripUnsupportedClaims('Lovely dress. Comes with a lifetime guarantee.', FACTS);
    expect(result.text).toBe('Lovely dress.');
    expect(result.removed).toContain('a warranty or guarantee the product doesn’t state');
  });

  it('reports each reason once however many sentences broke the rule', () => {
    const result = stripUnsupportedClaims('Only 2 left! Hurry, selling fast! A wrap dress.', FACTS);
    expect(result.removed).toEqual(['a stock or urgency claim']);
  });

  it('can strip everything, leaving nothing to publish', () => {
    const result = stripUnsupportedClaims('Only 1 left! 50% off!', FACTS);
    expect(result.text).toBe('');
  });
});

describe('stripForeignLinks', () => {
  it('keeps the product’s own link', () => {
    const text = `Shop it here: ${FACTS.productUrl}`;
    expect(stripForeignLinks(text, FACTS.productUrl)).toBe(text);
  });

  it('removes a link the model invented', () => {
    const result = stripForeignLinks('Buy at https://totally-not-your-shop.example.com now', FACTS.productUrl);
    expect(result).not.toContain('totally-not-your-shop');
  });

  it('removes every link when the product has none', () => {
    const result = stripForeignLinks('See www.example.com for more', null);
    expect(result).not.toContain('example.com');
  });
});

describe('cleanHashtag', () => {
  it('normalises what a model tends to return', () => {
    expect(cleanHashtag('#ankara')).toBe('#ankara');
    expect(cleanHashtag('ankara')).toBe('#ankara');
    expect(cleanHashtag('  ##ankara dress ')).toBe('#ankaradress');
  });

  it('rejects tags that are not tags', () => {
    expect(cleanHashtag('#')).toBeNull();
    expect(cleanHashtag('#123')).toBeNull();
    expect(cleanHashtag('#a')).toBeNull();
    expect(cleanHashtag(`#${'x'.repeat(40)}`)).toBeNull();
  });
});

describe('cleanHashtags', () => {
  it('drops engagement bait and price claims', () => {
    const result = cleanHashtags(['ankara', 'follow4follow', 'fyp', 'sale', 'freeshipping', 'dresses']);
    expect(result).toEqual(['#ankara', '#dresses']);
  });

  it('de-duplicates case-insensitively and keeps order', () => {
    expect(cleanHashtags(['Ankara', 'ankara', 'ANKARA', 'dresses'])).toEqual(['#Ankara', '#dresses']);
  });

  it('caps at the platform limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(cleanHashtags(many, 12)).toHaveLength(12);
  });
});
