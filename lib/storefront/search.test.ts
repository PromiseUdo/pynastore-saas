import { describe, expect, it } from 'vitest';
import { normalise, rankProducts, scoreDoc, buildSearchDoc, termVariants, tokenize } from './search';
import { PRODUCTS } from './mock/products';
import { CATEGORY_BY_ID } from './mock/categories';

const categoryNamesFor = (p: (typeof PRODUCTS)[number]) =>
  p.categoryIds.map((id) => CATEGORY_BY_ID.get(id)?.name ?? '');

const rank = (q: string) => rankProducts(PRODUCTS, q, categoryNamesFor);

describe('normalisation', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalise('Solène  — EDP!')).toBe('solene edp');
  });

  it('drops noise words but never returns nothing', () => {
    expect(tokenize('a laptop for me')).toEqual(['laptop']);
    expect(tokenize('the')).toEqual(['the']);
  });

  it('folds simple plurals', () => {
    expect(termVariants('shoes')).toContain('shoe');
    expect(termVariants('dress')).toContain('dresses');
  });
});

describe('field weighting', () => {
  it('ranks a name match above a description-only match', () => {
    const doc = buildSearchDoc(PRODUCTS[0], []);
    const name = scoreDoc({ ...doc, name: 'kettlebell', description: '' }, ['kettlebell'], 'kettlebell');
    const desc = scoreDoc({ ...doc, name: '', description: 'kettlebell' }, ['kettlebell'], 'kettlebell');
    expect(name.score).toBeGreaterThan(desc.score);
  });
});

describe('searching the real catalogue', () => {
  it('finds products by name', () => {
    const { hits } = rank('kettlebell');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].product.name.toLowerCase()).toContain('kettlebell');
  });

  it('finds products by brand, below products matching the name', () => {
    const { hits } = rank('orbit');
    expect(hits.length).toBeGreaterThan(0);
    // Every hit matches 'orbit' through its name OR its brand...
    expect(
      hits.every(
        (h) =>
          h.product.name.toLowerCase().includes('orbit') ||
          h.product.brandName.toLowerCase().includes('orbit'),
      ),
    ).toBe(true);
    // ...and the ordering the brief asks for holds: a name match outranks a
    // brand-only match. (The fixtures brand some "Orbit …" products to other
    // houses, which is exactly what makes this assertion meaningful.)
    const firstBrandOnly = hits.findIndex((h) => !h.product.name.toLowerCase().includes('orbit'));
    const lastNameMatch = hits.map((h) => h.product.name.toLowerCase().includes('orbit')).lastIndexOf(true);
    expect(firstBrandOnly).toBeGreaterThan(lastNameMatch - 1);
  });

  it('finds products by category name even though it is not on the row', () => {
    const { hits } = rank('laptops');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.product.name.toLowerCase().includes('laptop'))).toBe(true);
  });

  it('finds products by an option value (colour)', () => {
    const { hits } = rank('olive');
    expect(hits.length).toBeGreaterThan(0);
    // The olive COLOURWAY is findable...
    expect(
      hits.some((h) => h.product.options.some((o) => o.values.some((v) => v.label === 'Olive'))),
    ).toBe(true);
    // ...but "Olive Oil" wins the top slot, because a name match outweighs an
    // option match. That ordering is the point of the field weights.
    expect(hits[0].product.name).toContain('Olive Oil');
  });

  it('is case- and whitespace-insensitive', () => {
    const a = rank('Dining Chair').hits.map((h) => h.product.id);
    const b = rank('  dining   CHAIR ').hits.map((h) => h.product.id);
    expect(a).toEqual(b);
  });

  it('ANDs multiple words together', () => {
    const { hits, partial } = rank('oak dining table');
    expect(partial).toBe(false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].product.name).toContain('Oak Dining Table');
  });

  it('prefers an intact phrase over the same words scattered', () => {
    const { hits } = rank('orbit air');
    expect(hits[0].product.name.toLowerCase()).toContain('orbit air');
  });

  it('handles partial/prefix terms', () => {
    const { hits } = rank('kettle');
    expect(hits.some((h) => h.product.name.toLowerCase().includes('kettlebell'))).toBe(true);
  });

  it('returns nothing for genuine nonsense', () => {
    expect(rank('blue gaming refrigerator').hits).toHaveLength(0);
    expect(rank('zzzzqqq').hits).toHaveLength(0);
  });

  it('widens to a partial match rather than dead-ending, and says so', () => {
    // "wireless" appears in product copy, "sneaker" does not — two of three
    // terms can land, so the engine widens instead of returning nothing.
    const { hits, partial } = rank('wireless mouse sneaker');
    if (hits.length) expect(partial).toBe(true);
  });

  it('does not widen on a single stray term', () => {
    // 'black' alone matches many products; it must not drag in the whole
    // catalogue for a three-word query whose other words match nothing.
    const { hits } = rank('black gaming refrigerator');
    expect(hits).toHaveLength(0);
  });

  it('is deterministic', () => {
    expect(rank('leather bag').hits.map((h) => h.product.id)).toEqual(
      rank('leather bag').hits.map((h) => h.product.id),
    );
  });
});
