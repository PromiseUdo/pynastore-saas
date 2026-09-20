import { describe, expect, it } from 'vitest';
import { EMPTY_RULE, collectionKindLabel, collectionSortLabel, ruleIsEmpty, ruleProblem, ruleSummary } from './collection-rules';

const money = (n: number) => `₦${n.toLocaleString('en-NG')}`;

describe('collection rules', () => {
  it('labels kinds and sorts in plain language', () => {
    expect(collectionKindLabel('CURATED')).toBe('Hand-picked');
    expect(collectionKindLabel('DYNAMIC')).toBe('Automatic');
    expect(collectionSortLabel('BESTSELLING')).toBe('Best selling first');
  });

  it('requires at least one condition and a sane price range', () => {
    expect(ruleIsEmpty(EMPTY_RULE)).toBe(true);
    expect(ruleProblem(EMPTY_RULE)).toMatch(/at least one condition/);
    expect(ruleProblem({ ...EMPTY_RULE, matchTag: 'sale' })).toBeNull();
    expect(ruleProblem({ ...EMPTY_RULE, matchTag: 'nope' })).toMatch(/tag isn’t recognised/);
    expect(ruleProblem({ ...EMPTY_RULE, matchMinPrice: 5000, matchMaxPrice: 5000 })).toMatch(/more than the lowest/);
    expect(ruleProblem({ ...EMPTY_RULE, matchCreatedWithinDays: 0 })).toMatch(/between 1 and 3,650/);
  });

  it('describes a rule as a sentence', () => {
    expect(
      ruleSummary(
        { matchCategoryId: 'c1', matchTag: 'sale', matchMinPrice: 5000, matchMaxPrice: 20000, matchCreatedWithinDays: 30 },
        { categoryPath: ['Fashion', 'Women'], formatMoney: money },
      ),
    ).toBe('Products in Fashion › Women, tagged On sale, priced ₦5,000–₦20,000, added in the last 30 days.');

    expect(ruleSummary({ ...EMPTY_RULE, matchMaxPrice: 50000 }, { formatMoney: money })).toBe('Products under ₦50,000.');
    expect(ruleSummary({ ...EMPTY_RULE, matchMinPrice: 1000 }, { formatMoney: money })).toBe('Products from ₦1,000.');
    expect(ruleSummary(EMPTY_RULE, { formatMoney: money })).toMatch(/No conditions yet/);
  });
});
