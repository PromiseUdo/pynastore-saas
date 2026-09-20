/*
 * lib/storefront/recommendations — the Recommendation contract.
 *
 * Phase 11 adds a way for the storefront to say "these are relevant to YOU
 * and to what you're doing right now". It does not add a second catalogue,
 * a second product card or a second matcher. The pipeline:
 *
 *   page context  +  session signals (ids + recent queries only)
 *        ↓  RecommendationRequest
 *   recommendProducts()          ← ./service.ts      (the ONLY entry point)
 *        ↓
 *   RecommendationProvider       ← ./rules-provider.ts
 *        ↓  reads through          (ranks ids — it never returns rows)
 *   RecommendationCatalogue      ← ./catalogue.ts    (the ONLY door to products)
 *        ↓  lib/storefront/catalog.ts listProducts — the Product Discovery engine
 *        ↓
 *   service re-resolves every id through the SAME scoped catalogue, applies
 *   exclusions + availability, falls back when thin, and returns
 *        ↓  RecommendationResponse
 *   <RecommendationSection>  →  the existing <ProductCard>
 *
 * Three rules a provider — mock or real — may never break:
 *
 *  1. TENANT ISOLATION. A provider is handed a catalogue built from a
 *     StoreScope resolved server-side. It never names a store, and every
 *     signal id is resolved through that scope, so another merchant's
 *     products or behaviour cannot reach this store's rails.
 *  2. CATALOGUE GROUNDING. A recommendation is an id the catalogue returned.
 *     The provider ranks and explains; the Product Discovery engine supplies
 *     the product.
 *  3. HONEST REASONS. A reason names a signal that genuinely produced the
 *     item. "Often bought together" is only ever said of a pair that shares
 *     real baskets in THIS store (accepted orders or sold invoices, at least
 *     MIN_SHARED_BASKETS — see lib/storefront/data/bought-together.ts); a
 *     pairing the merchant set is "goes with", never "customers bought".
 *
 * Nothing in this file is provider-specific — no embedding, no model, no
 * vendor field — which is what lets a real engine land as one new module.
 */
import type { Product, StoreScope } from '@/lib/storefront/types';

/* ────────────────────────────── placements ───────────────────────────── */

/**
 * Where on the storefront a recommendation block lives.
 *
 * A placement decides the STRATEGY, not the copy: the product page asks for
 * things like this product, the bag asks for things that go with it. Adding a
 * placement is a value here plus a branch in the provider — no page changes.
 */
export const RECOMMENDATION_PLACEMENTS = {
  homepage: 'homepage',
  product: 'product',
  cart: 'cart',
  search: 'search',
  category: 'category',
} as const;

export type RecommendationPlacement =
  (typeof RECOMMENDATION_PLACEMENTS)[keyof typeof RECOMMENDATION_PLACEMENTS];

/** The same values as a tuple, for request validation. */
export const PLACEMENT_VALUES = [
  RECOMMENDATION_PLACEMENTS.homepage,
  RECOMMENDATION_PLACEMENTS.product,
  RECOMMENDATION_PLACEMENTS.cart,
  RECOMMENDATION_PLACEMENTS.search,
  RECOMMENDATION_PLACEMENTS.category,
] as const;

/* ─────────────────────────────── signals ─────────────────────────────── */

/**
 * What the shopper has done this session, as REFERENCES only.
 *
 * Product ids and short query strings — never product data, never anything
 * identifying. The server resolves every id through the tenant's catalogue,
 * so a forged or foreign id simply doesn't resolve.
 *
 * Every field is optional: a first-time visitor sends nothing, and that is a
 * supported state (cold start), not an error.
 */
export interface RecommendationSignals {
  /** most recent first */
  recentlyViewedIds?: string[];
  wishlistIds?: string[];
  cartIds?: string[];
  /** most recent first */
  recentQueries?: string[];
  /** category slug paths the shopper browsed, most recent first */
  recentCategoryPaths?: string[][];
}

/** Hard caps — applied by the service whatever the caller sent. */
export const SIGNAL_LIMITS = {
  recentlyViewedIds: 12,
  wishlistIds: 12,
  cartIds: 20,
  recentQueries: 5,
  recentCategoryPaths: 5,
} as const;

/* ─────────────────────────────── request ─────────────────────────────── */

/** The page the block sits on. Which fields matter depends on the placement. */
export interface RecommendationContext {
  /** product page: the product being viewed */
  productId?: string;
  /** category page: the category being browsed */
  categoryPath?: string[];
  /** search page: the query as typed */
  query?: string;
  signals?: RecommendationSignals;
}

export interface RecommendationRequest {
  /** resolved server-side from the route — never taken from a client body */
  store: StoreScope;
  placement: RecommendationPlacement;
  context: RecommendationContext;
  /** how many to return; clamped to 1..MAX_RECOMMENDATIONS */
  limit?: number;
  /** product ids that must not appear — e.g. the results already on screen */
  exclude?: string[];
}

export const DEFAULT_RECOMMENDATIONS = 8;
export const MAX_RECOMMENDATIONS = 16;

/* ─────────────────────────────── reasons ─────────────────────────────── */

/**
 * Why an item is here. Each kind maps to a signal that actually exists.
 * Deliberately absent: anything implying purchase history.
 */
export type RecommendationReasonKind =
  | 'similar-to-product'
  | 'viewed-similar'
  | 'wishlist-similar'
  | 'wishlist-complement'
  | 'cart-similar'
  | 'browsing-affinity'
  | 'complements-cart'
  | 'bought-together'
  | 'related-to-search'
  | 'popular-in-category'
  | 'trending'
  | 'popular'
  | 'new-arrival'
  | 'featured';

export interface RecommendationReason {
  kind: RecommendationReasonKind;
  /** shopper-facing, already worded — e.g. "Popular in Sneakers & Trainers" */
  label: string;
}

/**
 * Which rung of the fallback ladder produced a response (§13). The UI uses
 * it to pick a subtitle that doesn't over-claim — a cold-start block must not
 * say "based on your browsing".
 */
export type RecommendationStrategy =
  | 'personalized'
  | 'contextual'
  | 'popular'
  | 'new-arrivals'
  | 'curated';

/* ──────────────────────────────── provider ───────────────────────────── */

/** One ranked id, as a provider produces it. No product data. */
export interface RankedRecommendation {
  productId: string;
  score: number;
  reason: RecommendationReason;
  strategy: RecommendationStrategy;
}

export interface RecommendationProvider {
  readonly name: string;
  /**
   * Rank candidate ids for a request. May return fewer than asked, or none —
   * the service owns the fallback. Must read products ONLY through
   * `catalogue`, which is already scoped to the request's store.
   */
  recommend(
    request: NormalizedRecommendationRequest,
    catalogue: RecommendationCatalogue,
  ): Promise<RankedRecommendation[]>;
}

/** A request after the service has clamped and sanitised it. */
export interface NormalizedRecommendationRequest extends RecommendationRequest {
  limit: number;
  exclude: string[];
  context: RecommendationContext & { signals: Required<RecommendationSignals> };
}

/* ─────────────────────────────── catalogue ───────────────────────────── */

/** Minimal category shape the recommender needs. */
export interface RecommendationCategory {
  id: string;
  slug: string;
  name: string;
  path: string[];
  parentId: string | null;
}

/**
 * The recommender's port onto Product Discovery. Implemented in
 * ./catalogue.ts; a provider receives one and has no other way to products.
 */
export interface RecommendationCatalogue {
  readonly store: StoreScope;
  /** products for ids, in the order given; unknown/foreign ids drop out */
  productsByIds(ids: string[]): Promise<Product[]>;
  /** best-selling products in a category subtree (or the whole store) */
  bestsellers(params: { categoryPath?: string[]; limit: number }): Promise<Product[]>;
  /** newest products in the store */
  newest(limit: number): Promise<Product[]>;
  /** products carrying a merchandising tag, best-selling first */
  tagged(tag: 'trending' | 'featured', limit: number): Promise<Product[]>;
  /** the text-search engine's top hits for a query */
  search(query: string, limit: number): Promise<Product[]>;
  categoryById(id: string): Promise<RecommendationCategory | null>;
  categoryByPath(path: string[]): Promise<RecommendationCategory | null>;
  /**
   * The merchant's "goes well with" categories for a category, best first;
   * null when none are set. Only categories shoppers can reach.
   */
  companions(categoryId: string): Promise<RecommendationCategory[] | null>;
  /**
   * Products sharing real baskets with this one in THIS store, strongest
   * first. Ids only, like every other ranking input — the service grounds them.
   */
  boughtTogether(productId: string, limit: number): Promise<{ productId: string; baskets: number }[]>;
}

/* ─────────────────────────────── response ────────────────────────────── */

export interface RecommendationItem {
  product: Product;
  reason: RecommendationReason;
  score: number;
  /** 1-based, contiguous */
  rank: number;
  strategy: RecommendationStrategy;
}

export interface RecommendationResponse {
  placement: RecommendationPlacement;
  items: RecommendationItem[];
  total: number;
  /** the strategy that produced the FIRST item — what the block is "about" */
  strategy: RecommendationStrategy | null;
  /** true when the provider failed and only fallbacks were used */
  degraded: boolean;
}

/* ──────────────────────────────── errors ─────────────────────────────── */

export class RecommendationError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_request',
  ) {
    super(message);
    this.name = 'RecommendationError';
  }
}
