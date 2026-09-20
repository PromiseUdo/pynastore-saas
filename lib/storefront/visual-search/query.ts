/*
 * The visual query ⇄ URL codec, alongside lib/storefront/discovery-url.ts
 * rather than inside it: a visual query is not a filter, and the discovery
 * codec should stay the model of what a shopper narrowed.
 *
 *   /search/image                 → nothing chosen yet
 *   /search/image?vq=<query id>   → a shopper's photo, embedded and stored
 *                                   server-side (the id means nothing to
 *                                   any other store)
 *   /search/image?p=<product id>  → "find similar" from a product
 *
 * Both forms survive filtering, sorting and paging because `buildHref`
 * carries whatever the route already pinned on the pathname, so the search
 * is never thrown away by the shopper's first tap.
 */
import type { RawParams } from '@/lib/storefront/discovery-url';
import { VISUAL_QUERY_PARAM, VISUAL_SOURCE_PRODUCT_PARAM } from './image';
import type { VisualSearchSource } from './types';

/** The route the whole feature lives at. */
export const VISUAL_SEARCH_PATH = '/search/image';

/** Product ids are cuids (or `prod_<slug>` in the demo); anything else is a hand-edited URL. */
const PRODUCT_ID_PATTERN = /^[a-z0-9_-]{1,120}$/i;
/** Stored query ids are `vq_` + 32 hex characters (vector-store.ts). */
const QUERY_ID_PATTERN = /^vq_[0-9a-f]{32}$/;

function readOne(raw: RawParams, key: string): string | undefined {
  const value = raw[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/**
 * URL → source, or null for "no image chosen". Junk decodes to null rather
 * than throwing, so a stale or edited link lands on the upload screen.
 */
export function parseVisualSource(raw: RawParams): VisualSearchSource | null {
  const queryId = readOne(raw, VISUAL_QUERY_PARAM);
  if (queryId && QUERY_ID_PATTERN.test(queryId)) return { kind: 'query', queryId };

  const productId = readOne(raw, VISUAL_SOURCE_PRODUCT_PARAM);
  if (productId && PRODUCT_ID_PATTERN.test(productId)) return { kind: 'product', productId };
  return null;
}

/**
 * The pathname a results page hands to the Product Discovery Service. The
 * visual query rides on the PATHNAME, so every filter chip, sort option and
 * pager link keeps it without knowing visual search exists.
 */
export function visualSearchPathname(source: VisualSearchSource): string {
  const token =
    source.kind === 'query'
      ? `${VISUAL_QUERY_PARAM}=${encodeURIComponent(source.queryId)}`
      : `${VISUAL_SOURCE_PRODUCT_PARAM}=${encodeURIComponent(source.productId)}`;
  return `${VISUAL_SEARCH_PATH}?${token}`;
}

/** Link to "find similar products" for a product. Used by the product page. */
export function findSimilarHref(productId: string): string {
  return `${VISUAL_SEARCH_PATH}?${VISUAL_SOURCE_PRODUCT_PARAM}=${encodeURIComponent(productId)}`;
}

/** Link to the results of a stored image search. */
export function imageSearchHref(queryId: string): string {
  return `${VISUAL_SEARCH_PATH}?${VISUAL_QUERY_PARAM}=${encodeURIComponent(queryId)}`;
}
