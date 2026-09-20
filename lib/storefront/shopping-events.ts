/*
 * Shopping events — the storefront's behaviour boundary.
 *
 * A deliberately tiny, internal abstraction (§21).
 *
 *   component ─▶ trackShoppingEvent() ─┬─▶ activity store (sessionStorage)
 *                                      └─▶ listeners (none today)
 *
 * WHERE THE DATA GOES
 *
 *  • Raw events stay in the browser. They are recorded into the tab's
 *    sessionStorage, namespaced by store and capped
 *    (stores/shopping-activity-store.ts), and handed to any in-page listener.
 *    Closing the tab clears them.
 *  • There is no third-party analytics service. Nothing subscribes to the
 *    listeners today; a future pipeline would subscribe here, with no
 *    component changes.
 *  • Derived signals DO go to our own server. When a personalised
 *    recommendation block is requested, useRecommendationSignals()
 *    (recommendations/use-recommendations.ts) derives the recent searches and
 *    browsed category paths from these events, adds the product ids held by
 *    the other client stores (recently viewed, wishlist, bag), and POSTs them
 *    to /api/storefront/recommendations. The raw event log itself is never
 *    sent.
 *  • The server does not persist those signals. It uses them to rank that
 *    one response and discards them; the response is `private, no-store`, and
 *    the request is a POST so the signals stay out of URLs and access logs.
 *
 * Events carry ids and short strings only: no names, prices or anything that
 * would make a stored log a profile of a person (§22, §34).
 */
import { useShoppingActivityStore } from './stores/shopping-activity-store';
import type { RecommendationPlacement } from './recommendations/types';

export const SHOPPING_EVENTS = {
  productViewed: 'product_viewed',
  productSearched: 'product_searched',
  categoryViewed: 'category_viewed',
  addedToCart: 'product_added_to_cart',
  removedFromCart: 'product_removed_from_cart',
  wishlistAdded: 'wishlist_added',
  wishlistRemoved: 'wishlist_removed',
  recommendationClicked: 'recommendation_clicked',
} as const;

export type ShoppingEventName = (typeof SHOPPING_EVENTS)[keyof typeof SHOPPING_EVENTS];

export type ShoppingEvent =
  | { name: typeof SHOPPING_EVENTS.productViewed; productId: string }
  | { name: typeof SHOPPING_EVENTS.productSearched; query: string }
  | { name: typeof SHOPPING_EVENTS.categoryViewed; categoryPath: string[] }
  | { name: typeof SHOPPING_EVENTS.addedToCart; productId: string }
  | { name: typeof SHOPPING_EVENTS.removedFromCart; productId: string }
  | { name: typeof SHOPPING_EVENTS.wishlistAdded; productId: string }
  | { name: typeof SHOPPING_EVENTS.wishlistRemoved; productId: string }
  | {
      name: typeof SHOPPING_EVENTS.recommendationClicked;
      productId: string;
      placement: RecommendationPlacement;
      rank: number;
    };

export type RecordedShoppingEvent = ShoppingEvent & { at: number };

type Listener = (event: RecordedShoppingEvent) => void;
const listeners = new Set<Listener>();

/** Record an event. Safe to call during SSR (it no-ops). */
export function trackShoppingEvent(event: ShoppingEvent): void {
  if (typeof window === 'undefined') return;
  const recorded: RecordedShoppingEvent = { ...event, at: Date.now() };
  useShoppingActivityStore.getState().record(recorded);
  for (const listener of listeners) {
    try {
      listener(recorded);
    } catch {
      /* a listener must never break the page that emitted the event */
    }
  }
}

/** Subscribe to events as they happen. Returns the unsubscribe function. */
export function subscribeShoppingEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ─────────────────────────── derived signals ─────────────────────────── */

/** Distinct recent queries, most recent first. */
export function recentQueries(events: RecordedShoppingEvent[], limit: number): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const event = events[i];
    if (event.name !== SHOPPING_EVENTS.productSearched) continue;
    const query = event.query.trim().toLowerCase();
    if (query && !out.includes(query)) out.push(query);
  }
  return out;
}

/** Distinct recently browsed category paths, most recent first. */
export function recentCategoryPaths(events: RecordedShoppingEvent[], limit: number): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const event = events[i];
    if (event.name !== SHOPPING_EVENTS.categoryViewed) continue;
    const key = event.categoryPath.join('/');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(event.categoryPath);
  }
  return out;
}
