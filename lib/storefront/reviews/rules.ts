/*
 * lib/storefront/reviews/rules.ts
 *
 * What a review may be, how a shopper is named on one, and how a pile of
 * ratings becomes the summary shown beside a product. No database, no
 * request — just the rules, so they can be tested and so the storefront and
 * the admin can never disagree about them.
 *
 * The one rule that is NOT here is who may write a review: that needs the
 * order history, and lives in ./read.ts where it can be checked against the
 * merchant's own records rather than against anything a browser sent.
 */
import type { Review, ReviewSummary } from '../types';

export const RATING_VALUES = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATING_VALUES)[number];

export const TITLE_MAX = 80;
export const BODY_MIN = 20;
export const BODY_MAX = 2000;

export interface ReviewDraft {
  rating: number;
  title: string;
  body: string;
}

export interface ValidReview {
  rating: Rating;
  title: string;
  body: string;
}

export type ValidationResult =
  | { ok: true; value: ValidReview }
  | { ok: false; fieldErrors: Partial<Record<'rating' | 'title' | 'body', string>> };

export function isRating(value: number): value is Rating {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Check a draft review.
 *
 * The body has a floor because "good" tells the next shopper nothing, and a
 * ceiling because a field with none is a field someone will paste a novel
 * into. Both are counted after trimming, so whitespace can't satisfy either.
 */
export function validateReview(draft: ReviewDraft): ValidationResult {
  const fieldErrors: Partial<Record<'rating' | 'title' | 'body', string>> = {};

  const title = draft.title.trim();
  const body = draft.body.trim();

  if (!isRating(draft.rating)) fieldErrors.rating = 'Choose a rating from 1 to 5 stars';
  if (!title) fieldErrors.title = 'Give your review a short headline';
  else if (title.length > TITLE_MAX) fieldErrors.title = `Keep the headline under ${TITLE_MAX} characters`;

  if (body.length < BODY_MIN) fieldErrors.body = `Tell other shoppers a little more — at least ${BODY_MIN} characters`;
  else if (body.length > BODY_MAX) fieldErrors.body = `Reviews can be up to ${BODY_MAX} characters`;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return { ok: true, value: { rating: draft.rating as Rating, title, body } };
}

/**
 * How a reviewer is named in public: first name, last initial.
 *
 * A shopper gives their full name to have an order delivered, not to have it
 * published. "Amara O." is enough for a review to read as a person's.
 */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Verified buyer';
  const [first, ...rest] = parts;
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

const EMPTY_DISTRIBUTION = (): Record<Rating, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

export const NO_RATING: ReviewSummary = {
  average: 0,
  count: 0,
  distribution: EMPTY_DISTRIBUTION(),
};

/**
 * Ratings → the summary a product card and the reviews section both read.
 *
 * The average is rounded to one decimal because that is how it is printed;
 * rounding once, here, stops "4.25" showing as 4.3 in one place and 4.2 in
 * another. The distribution is counts, never percentages — the bars work
 * those out from the total, so they always add up.
 */
export function summarise(ratings: Iterable<number>): ReviewSummary {
  const distribution = EMPTY_DISTRIBUTION();
  let count = 0;
  let total = 0;

  for (const value of ratings) {
    if (!isRating(value)) continue;
    distribution[value] += 1;
    total += value;
    count += 1;
  }

  if (count === 0) return { average: 0, count: 0, distribution };
  return { average: Math.round((total / count) * 10) / 10, count, distribution };
}

/** The same, when the counts are already grouped (SQL gives them that way). */
export function summariseCounts(counts: Partial<Record<Rating, number>>): ReviewSummary {
  const distribution = EMPTY_DISTRIBUTION();
  let count = 0;
  let total = 0;

  for (const value of RATING_VALUES) {
    const n = counts[value] ?? 0;
    if (n <= 0) continue;
    distribution[value] = n;
    count += n;
    total += value * n;
  }

  if (count === 0) return { average: 0, count: 0, distribution };
  return { average: Math.round((total / count) * 10) / 10, count, distribution };
}

export type ReviewSort = 'recent' | 'helpful' | 'rating-desc' | 'rating-asc';

export const REVIEW_SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'helpful', label: 'Most helpful' },
  { value: 'rating-desc', label: 'Highest rated' },
  { value: 'rating-asc', label: 'Lowest rated' },
];

const byNewest = (a: Review, b: Review) => b.createdAt.localeCompare(a.createdAt);

/** Sorting is total: every comparator falls back to newest, so a page of
 *  reviews is in the same order on every render. */
export function sortReviews(reviews: Review[], sort: ReviewSort = 'recent'): Review[] {
  const copy = [...reviews];
  switch (sort) {
    case 'helpful':
      return copy.sort((a, b) => b.helpful - a.helpful || byNewest(a, b));
    case 'rating-desc':
      return copy.sort((a, b) => b.rating - a.rating || byNewest(a, b));
    case 'rating-asc':
      return copy.sort((a, b) => a.rating - b.rating || byNewest(a, b));
    case 'recent':
    default:
      return copy.sort(byNewest);
  }
}
