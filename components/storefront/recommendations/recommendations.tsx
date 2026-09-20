'use client';

/*
 * <Recommendations> — a recommendation block for one placement.
 *
 * The only component a page drops in. It asks the Recommendation Service
 * (through useRecommendations) and hands rows to the presentational
 * <RecommendationSection>. It never sees a provider, a score formula or a
 * signal list — swapping the mock engine for a real one changes nothing here.
 *
 * Pages pass a server-rendered `initial` wherever the context is known at
 * render time (homepage, product, search, category), so the block paints
 * with the page and only refines once the session has something to add.
 */
import * as React from 'react';
import { RecommendationSection } from './recommendation-section';
import { recommendationHeading } from '@/lib/storefront/recommendations/copy';
import { useRecommendations } from '@/lib/storefront/recommendations/use-recommendations';
import { SHOPPING_EVENTS, trackShoppingEvent } from '@/lib/storefront/shopping-events';
import type {
  RecommendationContext,
  RecommendationPlacement,
  RecommendationResponse,
} from '@/lib/storefront/recommendations/types';

export function Recommendations({
  placement,
  context,
  exclude,
  limit,
  initial,
  enabled,
  id,
  href,
  categoryName,
  showReasons,
  minItems = 1,
  variant,
  className,
}: {
  placement: RecommendationPlacement;
  context?: Omit<RecommendationContext, 'signals'>;
  exclude?: string[];
  limit?: number;
  initial?: RecommendationResponse | null;
  enabled?: boolean;
  id?: string;
  href?: string;
  /** for "Popular in {category}" */
  categoryName?: string;
  showReasons?: boolean;
  /** hide the block when fewer than this many products come back */
  minItems?: number;
  variant?: 'rail' | 'band';
  className?: string;
}) {
  const { response, loading, error } = useRecommendations({
    placement,
    context,
    exclude,
    limit,
    initial,
    enabled,
  });

  const items = response?.items ?? [];
  const heading = recommendationHeading(placement, response?.strategy ?? null, { categoryName });

  if (!loading && items.length < minItems) return null;

  return (
    <RecommendationSection
      id={id}
      title={heading.title}
      subtitle={heading.subtitle}
      items={items.map((item) => ({ product: item.product, reason: item.reason.label }))}
      loading={loading}
      error={error}
      href={href}
      showReasons={showReasons}
      variant={variant}
      className={className}
      onProductClick={(product, rank) =>
        trackShoppingEvent({
          name: SHOPPING_EVENTS.recommendationClicked,
          productId: product.id,
          placement,
          rank,
        })
      }
    />
  );
}
