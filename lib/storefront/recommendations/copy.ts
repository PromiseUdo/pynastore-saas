/*
 * What a recommendation block is called, given what actually filled it.
 *
 * The heading has to follow the strategy, not the placement alone: a bag
 * whose items have no companion rule falls back to popular products, and
 * titling those "Complete your order" would be a claim the block can't keep
 * (§11). Likewise a cold-start homepage says "popular", never "based on your
 * browsing" (§34).
 *
 * Client-safe: pure strings.
 */
import type { RecommendationPlacement, RecommendationStrategy } from './types';

export interface RecommendationHeading {
  title: string;
  subtitle?: string;
}

export function recommendationHeading(
  placement: RecommendationPlacement,
  strategy: RecommendationStrategy | null,
  opts: { categoryName?: string } = {},
): RecommendationHeading {
  const fellBack = strategy === 'popular' || strategy === 'new-arrivals' || strategy === 'curated';

  switch (placement) {
    case 'homepage':
      return strategy === 'personalized'
        ? { title: 'Recommended for you', subtitle: 'Picked from what you’ve been browsing.' }
        : { title: 'Recommended for you', subtitle: 'Popular picks and new arrivals to start with.' };
    case 'product':
      return fellBack
        ? { title: 'You might also like', subtitle: 'Popular elsewhere in the store.' }
        : { title: 'You may also like', subtitle: 'Closest matches from the same part of the store.' };
    case 'cart':
      return fellBack
        ? { title: 'You might also like', subtitle: 'Popular in the store right now.' }
        : { title: 'Complete your order', subtitle: 'Goes well with what’s in your bag.' };
    case 'search':
      return fellBack
        ? { title: 'Popular right now' }
        : { title: 'You might also like', subtitle: 'More from the departments your search led to.' };
    case 'category':
      return fellBack || !opts.categoryName
        ? { title: 'Popular right now' }
        : {
            title: `Popular in ${opts.categoryName}`,
            subtitle:
              strategy === 'contextual' ? 'Ordered by what’s selling here.' : undefined,
          };
  }
}
