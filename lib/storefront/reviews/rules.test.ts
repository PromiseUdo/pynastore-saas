/*
 * The review rules: what may be written, how the writer is named, and how
 * ratings add up. No database — these are the decisions, not the storage.
 */
import { describe, expect, it } from 'vitest';
import {
  BODY_MIN,
  displayName,
  sortReviews,
  summarise,
  summariseCounts,
  validateReview,
} from './rules';
import type { Review } from '../types';

const draft = (over: Partial<{ rating: number; title: string; body: string }> = {}) => ({
  rating: 5,
  title: 'Exactly as described',
  body: 'It arrived in two days and the fabric is heavier than I expected, in a good way.',
  ...over,
});

describe('validating a review', () => {
  it('accepts a complete one and trims what it keeps', () => {
    const result = validateReview(draft({ title: '  Great bag  ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Great bag');
    expect(result.value.rating).toBe(5);
  });

  it('refuses a rating outside one to five, including a half', () => {
    for (const rating of [0, 6, 4.5, Number.NaN]) {
      const result = validateReview(draft({ rating }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors.rating).toBeTruthy();
    }
  });

  it('refuses whitespace dressed up as content', () => {
    const result = validateReview(draft({ title: '   ', body: ' '.repeat(BODY_MIN + 10) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.title).toBeTruthy();
    expect(result.fieldErrors.body).toBeTruthy();
  });

  it('asks for more than one word, because "good" helps nobody', () => {
    const result = validateReview(draft({ body: 'Good' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.body).toContain(String(BODY_MIN));
  });
});

describe('naming the reviewer', () => {
  it('publishes a first name and a last initial, never the full name', () => {
    expect(displayName('Amara Okonkwo')).toBe('Amara O.');
    expect(displayName('  ada  grace  bello ')).toBe('ada B.');
  });

  it('copes with one name, and with none', () => {
    expect(displayName('Tunde')).toBe('Tunde');
    expect(displayName('   ')).toBe('Verified buyer');
  });
});

describe('summarising ratings', () => {
  it('counts each star and rounds the average to one decimal', () => {
    const summary = summarise([5, 4, 4, 3]);
    expect(summary.count).toBe(4);
    expect(summary.average).toBe(4);
    expect(summary.distribution[4]).toBe(2);
  });

  it('rounds the same way whether counted one by one or grouped', () => {
    expect(summarise([5, 4, 4, 3, 1])).toEqual(summariseCounts({ 5: 1, 4: 2, 3: 1, 1: 1 }));
  });

  it('says "no ratings" rather than zero out of five', () => {
    expect(summarise([])).toEqual({ average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  });

  it('ignores a value that isn’t a star', () => {
    expect(summarise([5, 0, 7, 3.5]).count).toBe(1);
  });
});

describe('ordering a page of reviews', () => {
  const review = (id: string, over: Partial<Review>): Review => ({
    id,
    productId: 'p1',
    author: 'A B.',
    rating: 5,
    title: id,
    body: 'body',
    createdAt: '2026-01-01T00:00:00.000Z',
    verified: true,
    helpful: 0,
    ...over,
  });

  const items = [
    review('a', { helpful: 2, rating: 3, createdAt: '2026-05-01T00:00:00.000Z' }),
    review('b', { helpful: 9, rating: 5, createdAt: '2026-03-01T00:00:00.000Z' }),
    review('c', { helpful: 9, rating: 1, createdAt: '2026-04-01T00:00:00.000Z' }),
  ];

  it('sorts by the asked-for key, breaking ties with the newest', () => {
    expect(sortReviews(items, 'helpful').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(sortReviews(items, 'recent').map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortReviews(items, 'rating-desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortReviews(items, 'rating-asc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it("leaves the caller's array alone", () => {
    const before = items.map((r) => r.id);
    sortReviews(items, 'helpful');
    expect(items.map((r) => r.id)).toEqual(before);
  });
});
