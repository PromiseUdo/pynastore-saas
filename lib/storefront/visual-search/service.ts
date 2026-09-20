/*
 * The Visual Search Service — the one entry point the app calls.
 *
 *   server action ─▶ startImageSearch()      photo → embedding → stored query
 *   /search/image ─▶ visualSearchProducts()  stored vector → pgvector → rows
 *
 * The model is only ever asked for a vector (./embedding.ts, behind which
 * Gemini sits). Which products come back is decided by the database: an
 * exact cosine search over THIS store's product-image embeddings
 * (./vector-store.ts), which were generated once when each image was added
 * (./indexing.ts). Every id is then re-read through the store's catalogue
 * (./catalogue.ts), so what a shopper sees is always a real, visible,
 * sellable product of this store — never something a model produced.
 *
 * TENANT ISOLATION. `store` comes from the caller, who got it from trusted
 * server-side resolution: the proxy's host → store mapping (x-org-slug) for
 * the server action, the rewritten route for the page. It is turned into an
 * organisation id HERE, and that id is inside every SQL query — a query id or
 * product id from another store resolves to nothing.
 *
 * FAILURES never reach a shopper as an exception from startImageSearch: it
 * returns a coded result with a sentence to show. visualSearchProducts throws
 * only VisualSearchError, whose code the page turns into copy.
 */
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { prisma } from '@/lib/prisma';
import type { StoreScope } from '@/lib/storefront/types';
import { createVisualSearchCatalogue } from './catalogue';
import { visualSearchConfig } from './config';
import { getImageEmbedder, isRateLimited } from './embedding';
import { checkUploadedImage, IMAGE_INPUT_MESSAGES } from './image-input';
import {
  checkImageSearchRequest,
  noteEmbeddingRateLimited,
  reserveSearchEmbedding,
  type SearcherIdentity,
} from './quota';
import { loadQueryVector, nearestProducts, productVector, saveQueryVector } from './vector-store';
import {
  MAX_VISUAL_MATCHES,
  VisualSearchError,
  type VisualSearchConfidence,
  type VisualSearchRequest,
  type VisualSearchResponse,
} from './types';

/* ─────────────────────────── starting a search ───────────────────────── */

export type StartImageSearchFailure =
  | 'no_store'
  | 'rate_limited'
  | 'invalid_image'
  | 'not_ready'
  | 'busy'
  | 'unavailable';

export type StartImageSearchResult =
  | { ok: true; queryId: string }
  | { ok: false; code: StartImageSearchFailure; message: string; retryAfterSeconds?: number };

const MESSAGES: Record<Exclude<StartImageSearchFailure, 'invalid_image'>, string> = {
  no_store: 'We couldn’t reach the store. Please refresh and try again.',
  rate_limited: 'You’re searching a little fast. Give it a moment and try again.',
  not_ready: 'Search by image isn’t ready for this store yet. Try searching by name instead.',
  busy: 'Search by image is busy right now. Please try again in a minute, or search by name.',
  unavailable: 'Search by image isn’t responding right now. Please try again, or search by name.',
};

const fail = (code: Exclude<StartImageSearchFailure, 'invalid_image'>, retryAfterSeconds?: number) =>
  ({ ok: false, code, message: MESSAGES[code], retryAfterSeconds }) as const;

/**
 * Turn a shopper's uploaded photo into a stored, store-bound search.
 *
 * Order matters for cost: rate limits and cheap checks run before the image
 * is read, and a store with nothing indexed is told so before any model call.
 */
export async function startImageSearch(params: {
  store: StoreScope;
  file: unknown;
  who: SearcherIdentity;
}): Promise<StartImageSearchResult> {
  const slug = params.store.organizationSlug?.trim();
  const organization = slug ? await findStoreBySlug(slug) : null;
  if (!slug || !organization) return fail('no_store');

  const allowed = checkImageSearchRequest(slug, params.who);
  if (!allowed.ok) return fail('rate_limited', allowed.retryAfterSeconds);

  const checked = await checkUploadedImage(params.file);
  if (!checked.ok) {
    return { ok: false, code: 'invalid_image', message: IMAGE_INPUT_MESSAGES[checked.problem] };
  }

  const embedder = getImageEmbedder();
  const indexed = await prisma.productImageEmbedding.count({
    where: { organizationId: organization.id, status: 'INDEXED', model: embedder.model },
  });
  if (!indexed) return fail('not_ready');

  if (!embedder.configured()) {
    console.warn('[visual-search] no embedding credentials (GEMINI_API_KEY); image search is unavailable');
    return fail('unavailable');
  }
  if (!reserveSearchEmbedding(slug)) return fail('busy');

  let vector: number[];
  try {
    vector = await embedder.embedImage(checked.image);
  } catch (error) {
    if (isRateLimited(error)) {
      noteEmbeddingRateLimited(error.retryAfterMs);
      return fail('busy');
    }
    console.warn('[visual-search] embedding failed', error instanceof Error ? error.message : error);
    return fail('unavailable');
  }

  try {
    const queryId = await saveQueryVector({
      organizationId: organization.id,
      vector,
      model: embedder.model,
      expiresAt: new Date(Date.now() + visualSearchConfig().queryTtlMs),
    });
    return { ok: true, queryId };
  } catch (error) {
    console.error('[visual-search] could not store the query', error instanceof Error ? error.message : error);
    return fail('unavailable');
  }
}

/* ─────────────────────────── running a search ────────────────────────── */

/**
 * The store's products that look most like the query, best first, as real
 * catalogue rows. Throws VisualSearchError (never anything else).
 */
export async function visualSearchProducts(request: VisualSearchRequest): Promise<VisualSearchResponse> {
  const slug = request.store?.organizationSlug?.trim();
  if (!slug) throw new VisualSearchError('A store scope is required.', 'invalid_source');

  const config = visualSearchConfig();
  const limit = Math.min(Math.max(request.limit ?? config.maxResults, 1), MAX_VISUAL_MATCHES);
  const catalogue = createVisualSearchCatalogue({ organizationSlug: slug });

  try {
    const organization = await findStoreBySlug(slug);
    if (!organization) throw new VisualSearchError('Unknown store', 'invalid_source');

    /* ── the query vector, from this store only ──────────────────────── */
    let vector: string | null;
    let model: string;
    let excludeProductId: string | undefined;
    let queryId: string;

    if (request.source.kind === 'query') {
      const saved = await loadQueryVector(organization.id, request.source.queryId);
      if (!saved) throw new VisualSearchError('Query expired or not this store’s', 'expired');
      ({ vector, model } = saved);
      queryId = request.source.queryId;
    } else {
      const { productId } = request.source;
      // The product must be one this store shows — a foreign id is a broken link.
      if (!(await catalogue.productById(productId))) {
        throw new VisualSearchError(`Unknown product: ${productId}`, 'invalid_source');
      }
      model = getImageEmbedder().model;
      vector = await productVector(organization.id, productId, model);
      excludeProductId = productId;
      queryId = `product:${productId}`;
    }

    const currency = await catalogue.currency();
    // A "find similar" whose photos aren't indexed yet has nothing to compare.
    if (!vector) return emptyResponse(queryId, currency);

    /* ── nearest neighbours in pgvector, scoped in the SQL ───────────── */
    const nearest = await nearestProducts({
      organizationId: organization.id,
      vector,
      model,
      // Headroom: the catalogue may still drop some (hidden category, no online stock).
      limit: limit * 2,
      candidateImages: config.candidateImages,
      excludeProductId,
    });

    const best = nearest[0]?.similarity ?? 0;
    const floor = Math.max(config.minSimilarity, best - config.relativeBand);
    const kept = nearest.filter((n) => n.similarity >= floor);

    /* ── ground every id in the store's catalogue ────────────────────── */
    const products = await catalogue.productsByIds(kept.map((n) => n.productId));
    const scoreOf = new Map(kept.map((n) => [n.productId, n.similarity]));
    const shown = products.slice(0, limit);

    const matches = shown.map((p, i) => ({
      productId: p.id,
      score: scoreOf.get(p.id) ?? 0,
      rank: i + 1,
      reasons: ['visually-similar' as const],
    }));

    return {
      queryId,
      matches,
      products: shown,
      total: shown.length,
      confidence: confidenceFor(matches[0]?.score ?? 0),
      attributes: [],
      currency,
      priceFrom: shown.length ? Math.min(...shown.map((p) => p.priceFrom)) : null,
    };
  } catch (error) {
    if (error instanceof VisualSearchError) throw error;
    console.error('[visual-search] search failed', error instanceof Error ? error.message : error);
    throw new VisualSearchError('The visual search failed.', 'unavailable');
  }
}

export function confidenceFor(similarity: number): VisualSearchConfidence {
  const { strongSimilarity, goodSimilarity } = visualSearchConfig();
  if (similarity >= strongSimilarity) return 'high';
  if (similarity >= goodSimilarity) return 'medium';
  return 'low';
}

function emptyResponse(queryId: string, currency: string): VisualSearchResponse {
  return { queryId, matches: [], products: [], total: 0, confidence: 'low', attributes: [], currency, priceFrom: null };
}

/**
 * The ranked ids, for pinning as a DiscoveryScope.
 *
 * This is the whole handover between visual search and the rest of the
 * storefront: the search says WHICH products and in what order, and the
 * Product Discovery Service does everything else — filtering, sorting,
 * faceting, paging — exactly as it does for a category or a collection.
 */
export function matchesToScope(response: VisualSearchResponse): {
  productIds: string[];
  relevanceOrder: string[];
} {
  const ids = response.matches.map((m) => m.productId);
  return { productIds: ids, relevanceOrder: ids };
}
