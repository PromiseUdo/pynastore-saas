'use client';

/*
 * Client access to the Recommendation Service.
 *
 *   <Recommendations> ─▶ useRecommendations() ─▶ POST /api/storefront/recommendations
 *                              │                       └─ recommendProducts()
 *                              └─ signals from the stores that already exist:
 *                                 recently viewed, wishlist, bag, session events
 *
 * Pages server-render a cold (signal-free) response and pass it as `initial`,
 * so a first-time visitor gets a finished block with no request at all. A
 * request is only made once there is something to personalise with — and
 * identical requests share one in-flight promise, so two blocks asking the
 * same question (or a re-render) cost one round trip (§36).
 */
import * as React from 'react';
import { useStorefront, useHydrated } from '@/lib/storefront/context';
import { useCartStore } from '@/lib/storefront/stores/cart-store';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import { useRecentlyViewedStore } from '@/lib/storefront/stores/recently-viewed-store';
import { useShoppingActivityStore } from '@/lib/storefront/stores/shopping-activity-store';
import { recentCategoryPaths, recentQueries } from '@/lib/storefront/shopping-events';
import {
  SIGNAL_LIMITS,
  type RecommendationContext,
  type RecommendationPlacement,
  type RecommendationResponse,
  type RecommendationSignals,
} from './types';

/* ─────────────────────────────── signals ─────────────────────────────── */

export function hasSignals(signals: RecommendationSignals): boolean {
  return Boolean(
    signals.recentlyViewedIds?.length ||
      signals.wishlistIds?.length ||
      signals.cartIds?.length ||
      signals.recentQueries?.length ||
      signals.recentCategoryPaths?.length,
  );
}

/** The session's signals, read from the existing client stores. */
export function useRecommendationSignals(): { signals: RecommendationSignals; ready: boolean } {
  const mounted = useHydrated();
  const cartHydrated = useCartStore((s) => s.hydrated);
  const viewedIds = useRecentlyViewedStore((s) => s.ids);
  const wishlist = useWishlistStore((s) => s.items);
  const cart = useCartStore((s) => s.items);
  const events = useShoppingActivityStore((s) => s.events);

  const signals = React.useMemo<RecommendationSignals>(
    () => ({
      recentlyViewedIds: viewedIds.slice(0, SIGNAL_LIMITS.recentlyViewedIds),
      wishlistIds: wishlist.map((i) => i.productId).slice(0, SIGNAL_LIMITS.wishlistIds),
      cartIds: [...new Set(cart.map((i) => i.productId))].slice(0, SIGNAL_LIMITS.cartIds),
      recentQueries: recentQueries(events, SIGNAL_LIMITS.recentQueries),
      recentCategoryPaths: recentCategoryPaths(events, SIGNAL_LIMITS.recentCategoryPaths),
    }),
    [viewedIds, wishlist, cart, events],
  );

  return { signals, ready: mounted && cartHydrated };
}

/* ─────────────────────────────── transport ───────────────────────────── */

export interface RecommendationQuery {
  org: string;
  placement: RecommendationPlacement;
  context: RecommendationContext;
  exclude?: string[];
  limit?: number;
}

const MAX_CACHED = 30;
const cache = new Map<string, Promise<RecommendationResponse>>();

/** Test seam. */
export function clearRecommendationCache(): void {
  cache.clear();
}

/**
 * One request per distinct question. Failures are evicted so the next
 * render can retry; successes are kept for the life of the page.
 */
export function fetchRecommendations(query: RecommendationQuery): Promise<RecommendationResponse> {
  const key = JSON.stringify(query);
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = fetch('/api/storefront/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: key,
  }).then(async (res) => {
    if (!res.ok) throw new Error(`recommendations ${res.status}`);
    const data: RecommendationResponse = await res.json();
    return data;
  });

  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

/* ──────────────────────────────── hook ───────────────────────────────── */

export interface UseRecommendationsOptions {
  placement: RecommendationPlacement;
  context?: Omit<RecommendationContext, 'signals'>;
  exclude?: string[];
  limit?: number;
  /** a server-rendered, signal-free response — shown immediately */
  initial?: RecommendationResponse | null;
  /** false to hold the request (e.g. an empty bag) */
  enabled?: boolean;
}

export interface RecommendationsState {
  response: RecommendationResponse | null;
  loading: boolean;
  error: boolean;
}

export function useRecommendations(options: UseRecommendationsOptions): RecommendationsState {
  const { placement, context, exclude, limit, initial = null, enabled = true } = options;
  const { org } = useStorefront();
  const { signals, ready } = useRecommendationSignals();

  const query = React.useMemo<RecommendationQuery>(() => {
    // The product on screen is context, not history: leaving it in the
    // viewed list would change the request the moment the view is recorded.
    const viewed = context?.productId
      ? signals.recentlyViewedIds?.filter((id) => id !== context.productId)
      : signals.recentlyViewedIds;
    return {
      org: org.slug,
      placement,
      context: { ...context, signals: { ...signals, recentlyViewedIds: viewed } },
      exclude,
      limit,
    };
  }, [org.slug, placement, context, signals, exclude, limit]);

  const key = JSON.stringify(query);
  // Without an initial response there is nothing to show, so always ask.
  const shouldFetch = enabled && ready && (!initial || hasSignals(query.context.signals ?? {}));

  const [state, setState] = React.useState<RecommendationsState>({
    response: initial,
    loading: !initial && enabled,
    error: false,
  });

  React.useEffect(() => {
    if (!enabled) {
      setState({ response: null, loading: false, error: false });
      return;
    }
    if (!shouldFetch) {
      if (ready) setState({ response: initial, loading: false, error: false });
      return;
    }

    let cancelled = false;
    // Keep what's on screen while refining — no flash back to a skeleton.
    setState((prev) => ({ ...prev, loading: prev.response === null, error: false }));

    fetchRecommendations(query)
      .then((response) => {
        if (!cancelled) setState({ response, loading: false, error: false });
      })
      .catch(() => {
        // A failed refinement falls back to the server's block, if any (§31).
        if (!cancelled) setState({ response: initial, loading: false, error: !initial });
      });

    return () => {
      cancelled = true;
    };
    // `key` is `query` serialised — callers pass fresh context literals on
    // every render, so the object itself can't be the dependency. `initial`
    // is fixed per page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, shouldFetch, enabled, ready]);

  return state;
}
