/*
 * lib/storefront/visual-search — the Visual Product Search contract.
 *
 * Genuine image similarity: a shopper's photo and every product photo are
 * turned into embeddings by the same model, and the closest product photos —
 * in THIS store only — are the results. The pipeline:
 *
 *   shopper's photo (shrunk to a ≤1024px JPEG in the browser, ./image.ts)
 *        ↓  server action (features/shop-visual-search) — store from the
 *        ↓  proxy's host resolution, never from the client
 *   startImageSearch()        ← ./service.ts  validates, rate-limits, embeds
 *        ↓  one ImageEmbedder call (./embedding.ts → Gemini)
 *   visual_search_queries     the vector (never the photo), for 24h
 *        ↓  /search/image?vq=<id>
 *   visualSearchProducts()    ← ./service.ts  exact cosine search in pgvector
 *        ↓                      over this store's product-image embeddings
 *        ↓                      (./vector-store.ts), stored at indexing time
 *        ↓                      (./indexing.ts) — no model call per search
 *   VisualSearchCatalogue     ← ./catalogue.ts  every id re-read through the
 *        ↓                      store's own catalogue: published, visible,
 *        ↓                      sellable online — nothing a model invented
 *   /search/image             pins them as a DiscoveryScope, so filters,
 *                             sorting, paging and <ProductCard> are inherited.
 *
 * Rules nothing here may break:
 *  1. TENANT ISOLATION — the organisation filter is inside the vector query
 *     itself; ids from another store resolve to nothing.
 *  2. CATALOGUE GROUNDING — a model produces vectors, never products, prices,
 *     stock or links. Everything shown is a catalogue row.
 *  3. HONEST CONFIDENCE — the page says "closest we could find" when the best
 *     match is weak, rather than calling it a match.
 */
import type { Money, Product, StoreScope } from '@/lib/storefront/types';

/* ─────────────────────────── the upload ──────────────────────────────── */

/** Formats the picker accepts from the shopper's device. The browser
 *  converts every one of them to JPEG before upload. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** 12 MB — the most the picker will open; what's uploaded is far smaller. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/* ──────────────────────────────── request ───────────────────────────── */

/**
 * Where the visual query came from.
 *
 *   query    a shopper's uploaded photo, embedded once and stored briefly
 *   product  "find similar" from a product page — that product's own stored
 *            image embedding, so it costs no model call
 */
export type VisualSearchSource =
  | { kind: 'query'; queryId: string }
  | { kind: 'product'; productId: string };

export interface VisualSearchRequest {
  /** resolved server-side from the route's tenant, never from page state */
  store: StoreScope;
  source: VisualSearchSource;
  /** most matches to return — the ceiling the page then filters within */
  limit?: number;
}

/** Ranked matches beyond this are noise; it is also the page's result pool. */
export const MAX_VISUAL_MATCHES = 48;

/* ─────────────────────────────── response ───────────────────────────── */

/**
 * An attribute a search was narrowed by. Embedding search recognises no
 * named attributes, so today this is always empty — kept so the header can
 * show chips if a future search adds them, without inventing any now.
 */
export interface VisualAttribute {
  kind: 'category' | 'colour' | 'style' | 'material';
  label: string;
  value: string;
}

/** Why one product is in the results. */
export type VisualMatchReason = 'visually-similar';

export interface VisualSearchMatch {
  productId: string;
  /** cosine similarity of the product's closest image. Internal — never rendered (§13). */
  score: number;
  /** 1-based position in the ranking */
  rank: number;
  reasons: VisualMatchReason[];
}

/**
 * How strong the best match is — from the similarity thresholds in
 * ./config.ts. `low` is a first-class outcome, not a failure: it routes the
 * page to "closest we could find" instead of "visual matches".
 */
export type VisualSearchConfidence = 'high' | 'medium' | 'low';

export interface VisualSearchResponse {
  /** the stored query id, or `product:<id>` for "find similar" */
  queryId: string;
  matches: VisualSearchMatch[];
  /** matched products, resolved in rank order, as a convenience for callers
   *  that only need the rows (the assistant, a rail) rather than a page */
  products: Product[];
  total: number;
  confidence: VisualSearchConfidence;
  /** always empty for embedding search — see VisualAttribute */
  attributes: VisualAttribute[];
  /** ISO code everything in this response is priced in */
  currency: string;
  /** price span of the matched set, for the page's opening summary */
  priceFrom: Money | null;
}

/**
 * Thrown for a search that can't run. The page turns `code` into a friendly
 * sentence; the shopper never sees `message`.
 *
 *   invalid_source  the product id isn't this store's (a broken link)
 *   expired         the saved query has expired or isn't this store's
 *   unavailable     the database or the embedding model failed
 */
export class VisualSearchError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_source' | 'expired' | 'unavailable',
  ) {
    super(message);
    this.name = 'VisualSearchError';
  }
}

/* ──────────────────────────── analytics names ────────────────────────── */

/** Names only, matching ASSISTANT_EVENTS' convention. Nothing is emitted —
 *  there is still no analytics integration. */
export const VISUAL_SEARCH_EVENTS = {
  imageSelected: 'visual_image_selected',
  searchStarted: 'visual_search_started',
  matchOpened: 'visual_match_opened',
  findSimilar: 'visual_find_similar',
} as const;

export type VisualSearchEvent =
  (typeof VISUAL_SEARCH_EVENTS)[keyof typeof VISUAL_SEARCH_EVENTS];
