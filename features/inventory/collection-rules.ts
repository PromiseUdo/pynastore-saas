// features/inventory/collection-rules.ts
// Pure rules for collections. A category says what a product IS; a collection
// says why it's grouped ("Travel essentials"), so it can cut across categories
// and a product can be in many at once.
//
// Two kinds, one page in the storefront:
//  - CURATED: a hand-picked, ordered list of products.
//  - DYNAMIC: a rule over product attributes, re-resolved on every visit.

import type { CollectionKind, CollectionSort } from '@/lib/generated/prisma/enums';
import { PRODUCT_TAGS } from './product-rules';

export const COLLECTION_SORTS: { value: CollectionSort; label: string; hint: string }[] = [
  { value: 'RELEVANCE', label: 'Recommended', hint: 'The order that reads best for browsing.' },
  { value: 'NEWEST', label: 'Newest first', hint: 'Most recently added products first.' },
  { value: 'PRICE_ASC', label: 'Cheapest first', hint: 'Lowest price first.' },
  { value: 'PRICE_DESC', label: 'Most expensive first', hint: 'Highest price first.' },
  { value: 'BESTSELLING', label: 'Best selling first', hint: 'Ranked by units actually sold.' },
];

export function collectionSortLabel(sort: CollectionSort): string {
  return COLLECTION_SORTS.find((s) => s.value === sort)?.label ?? 'Recommended';
}

export function collectionKindLabel(kind: CollectionKind): string {
  return kind === 'CURATED' ? 'Hand-picked' : 'Automatic';
}

export type CollectionRule = {
  matchCategoryId: string | null;
  matchTag: string | null;
  matchMinPrice: number | null;
  matchMaxPrice: number | null;
  matchCreatedWithinDays: number | null;
};

export const EMPTY_RULE: CollectionRule = {
  matchCategoryId: null,
  matchTag: null,
  matchMinPrice: null,
  matchMaxPrice: null,
  matchCreatedWithinDays: null,
};

export function ruleIsEmpty(rule: CollectionRule): boolean {
  return (
    rule.matchCategoryId === null &&
    rule.matchTag === null &&
    rule.matchMinPrice === null &&
    rule.matchMaxPrice === null &&
    rule.matchCreatedWithinDays === null
  );
}

/** Plain-language problem with a dynamic rule, or null. */
export function ruleProblem(rule: CollectionRule): string | null {
  if (ruleIsEmpty(rule)) return 'Add at least one condition, or make this a hand-picked collection.';
  if (rule.matchMinPrice !== null && rule.matchMinPrice < 0) return 'The lowest price can’t be negative.';
  if (rule.matchMaxPrice !== null && rule.matchMaxPrice < 0) return 'The highest price can’t be negative.';
  if (rule.matchMinPrice !== null && rule.matchMaxPrice !== null && rule.matchMaxPrice <= rule.matchMinPrice) {
    return 'The highest price must be more than the lowest price.';
  }
  if (rule.matchTag !== null && !PRODUCT_TAGS.some((t) => t.value === rule.matchTag)) return 'That tag isn’t recognised.';
  if (rule.matchCreatedWithinDays !== null && (rule.matchCreatedWithinDays < 1 || rule.matchCreatedWithinDays > 3650)) {
    return 'Enter a number of days between 1 and 3,650.';
  }
  return null;
}

/**
 * One sentence describing what a dynamic rule collects, e.g.
 * "Products in Fashion › Women, tagged On sale, from ₦5,000, added in the last 30 days."
 */
export function ruleSummary(
  rule: CollectionRule,
  { categoryPath, formatMoney }: { categoryPath?: string[]; formatMoney: (n: number) => string },
): string {
  if (ruleIsEmpty(rule)) return 'No conditions yet — this collection would include nothing.';
  const parts: string[] = [];
  if (rule.matchCategoryId && categoryPath?.length) parts.push(`in ${categoryPath.join(' › ')}`);
  if (rule.matchTag) {
    const tag = PRODUCT_TAGS.find((t) => t.value === rule.matchTag);
    parts.push(`tagged ${tag ? tag.label : rule.matchTag}`);
  }
  if (rule.matchMinPrice !== null && rule.matchMaxPrice !== null) {
    parts.push(`priced ${formatMoney(rule.matchMinPrice)}–${formatMoney(rule.matchMaxPrice)}`);
  } else if (rule.matchMinPrice !== null) {
    parts.push(`from ${formatMoney(rule.matchMinPrice)}`);
  } else if (rule.matchMaxPrice !== null) {
    parts.push(`under ${formatMoney(rule.matchMaxPrice)}`);
  }
  if (rule.matchCreatedWithinDays !== null) {
    parts.push(rule.matchCreatedWithinDays === 1 ? 'added in the last day' : `added in the last ${rule.matchCreatedWithinDays} days`);
  }
  return `Products ${parts.join(', ')}.`;
}
