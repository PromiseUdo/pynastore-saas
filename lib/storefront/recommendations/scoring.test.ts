/*
 * Phase 11 — the scoring relationships the mock engine promises.
 *
 * Asserted as ORDERINGS rather than exact numbers: the weights are meant to
 * be tuned (or replaced by a model), but "same category beats a different
 * one" must survive any tuning.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  WEIGHTS,
  affinityScore,
  buildAffinityProfile,
  byScoreThenId,
  logPriceProximity,
  qualityReference,
  qualityScore,
  similarityScore,
} from './scoring';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import type { Product } from '@/lib/storefront/types';

const inCategory = (categoryId: string) => PRODUCTS.filter((p) => p.categoryId === categoryId);

const [sneakerA, sneakerB] = inCategory('cat_sneakers');
const laptop = inCategory('cat_laptops')[0];
const boot = inCategory('cat_boots')[0];

/** A copy of `base` with only the given fields changed — isolates one term. */
const variant = (base: Product, patch: Partial<Product>): Product => ({ ...base, ...patch });

describe('similarity', () => {
  it('ranks the same leaf category above a sibling aisle, and a sibling above another department', () => {
    const sameLeaf = similarityScore(sneakerA, sneakerB);
    const sibling = similarityScore(sneakerA, boot);
    const otherDepartment = similarityScore(sneakerA, laptop);

    expect(sameLeaf).toBeGreaterThan(sibling);
    expect(sibling).toBeGreaterThan(otherDepartment);
  });

  it('a matching brand increases relevance', () => {
    const otherBrand = variant(sneakerB, { brandId: 'brand_nobody' });
    const sameBrand = variant(sneakerB, { brandId: sneakerA.brandId });
    expect(similarityScore(sneakerA, sameBrand) - similarityScore(sneakerA, otherBrand)).toBeCloseTo(
      WEIGHTS.sameBrand,
    );
  });

  it('matching tags increase relevance', () => {
    const anchor = variant(sneakerA, { tags: ['trending', 'bestseller'] });
    const none = variant(sneakerB, { tags: [] });
    const both = variant(sneakerB, { tags: ['trending', 'bestseller'] });
    expect(similarityScore(anchor, both)).toBeGreaterThan(similarityScore(anchor, none));
  });

  it('a closer price only breaks ties — it never outranks category structure', () => {
    const cheapSameLeaf = variant(sneakerB, { priceFrom: sneakerA.priceFrom * 10 });
    const samePriceOtherDept = variant(laptop, { priceFrom: sneakerA.priceFrom });
    expect(similarityScore(sneakerA, cheapSameLeaf)).toBeGreaterThan(
      similarityScore(sneakerA, samePriceOtherDept),
    );
  });
});

describe('affinity', () => {
  it('is zero for a cold profile, so cold start is purely contextual', () => {
    const cold = buildAffinityProfile([]);
    expect(cold.strength).toBe(0);
    expect(affinityScore(cold, sneakerA)).toBe(0);
  });

  it('favours the category the shopper keeps viewing', () => {
    const profile = buildAffinityProfile([
      { product: sneakerA, weight: 1 },
      { product: sneakerB, weight: 1 },
    ]);
    expect(affinityScore(profile, boot)).toBeGreaterThan(affinityScore(profile, laptop));
  });

  it('favours the shopper’s brand', () => {
    const profile = buildAffinityProfile([{ product: sneakerA, weight: 1 }]);
    const sameBrand = variant(boot, { brandId: sneakerA.brandId });
    const otherBrand = variant(boot, { brandId: 'brand_nobody' });
    expect(affinityScore(profile, sameBrand)).toBeGreaterThan(affinityScore(profile, otherBrand));
  });

  it('favours the shopper’s price range on a log scale', () => {
    const profile = buildAffinityProfile([{ product: sneakerA, weight: 1 }]);
    const near = variant(boot, { priceFrom: sneakerA.priceFrom });
    const far = variant(boot, { priceFrom: sneakerA.priceFrom * 40 });
    expect(affinityScore(profile, near)).toBeGreaterThan(affinityScore(profile, far));
    expect(logPriceProximity(1000, 2000)).toBeCloseTo(logPriceProximity(500_000, 1_000_000));
  });

  it('scores products the shopper already viewed down', () => {
    const profile = buildAffinityProfile([{ product: sneakerA, weight: 1 }], {
      viewedIds: [sneakerB.id],
    });
    const unseen = variant(sneakerB, { id: 'prod_unseen' });
    expect(affinityScore(profile, sneakerB)).toBeLessThan(affinityScore(profile, unseen));
  });

  it('counts browsed categories even without a product', () => {
    const profile = buildAffinityProfile([], { browsedCategoryIds: [sneakerA.categoryIds] });
    expect(profile.strength).toBeGreaterThan(0);
    expect(affinityScore(profile, sneakerB)).toBeGreaterThan(affinityScore(profile, laptop));
  });
});

describe('quality and ordering', () => {
  it('pushes out-of-stock products below anything buyable', () => {
    const buyable = variant(sneakerA, { inStock: true, soldCount: 0 });
    const soldOut = variant(sneakerA, { inStock: false, soldCount: 10_000 });
    const reference = qualityReference([buyable, soldOut]);
    expect(qualityScore(soldOut, reference)).toBeLessThan(qualityScore(buyable, reference));
  });

  it('newness is relative to the pool, not the clock', () => {
    const reference = qualityReference([sneakerA, sneakerB]);
    const before = qualityScore(sneakerA, reference);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 90 * 86_400_000);
    try {
      expect(qualityScore(sneakerA, reference)).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('breaks score ties by id, never by input order', () => {
    const a = { productId: 'b', score: 1 };
    const b = { productId: 'a', score: 1 };
    expect([a, b].sort(byScoreThenId)).toEqual([b, a]);
    expect([b, a].sort(byScoreThenId)).toEqual([b, a]);
  });
});
