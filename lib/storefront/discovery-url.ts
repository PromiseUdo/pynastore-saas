/*
 * lib/storefront/discovery-url.ts
 *
 * The single codec between a storefront URL and a catalogue query.
 *
 * Search state lives in the URL, not in React state — that is what makes a
 * result set refreshable, shareable, back-button-correct and server-rendered.
 * Both directions live here so the server page that reads `searchParams` and
 * the client filter panel that writes them can never drift apart.
 *
 *   /search?q=black+sneakers&brand=orbit&colour=black&maxPrice=100000&sort=price-asc
 *
 * Prices are carried in MAJOR units (₦100,000 → `maxPrice=100000`) because a
 * URL is read by people; everything below this module speaks minor units.
 *
 * Option filters are keyed by readable names derived from the catalogue
 * (`?colour=black&size=m`) via the OptionIndex, rather than the opaque
 * `ov_col_black` ids the data layer uses.
 */
import type {
  ListProductsParams,
  Money,
  OptionIndex,
  ProductTag,
  SortKey,
  StoreScope,
} from './types';
import { SPEC_VALUE_PREFIX } from './types';

/** Next.js hands server pages this shape; URLSearchParams converts into it. */
export type RawParams = Record<string, string | string[] | undefined>;

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
  { value: 'bestselling', label: 'Most popular' },
];

const SORT_KEYS = new Set<string>(SORT_OPTIONS.map((s) => s.value));

const PRODUCT_TAGS: ProductTag[] = [
  'new', 'featured', 'bestseller', 'sale', 'deal-of-day', 'trending', 'limited',
];

/* Reserved so a merchant option literally named "Sort" can't hijack the key. */
export const RESERVED_URL_KEYS = new Set([
  'q', 'sort', 'page', 'brand', 'minprice', 'maxprice', 'rating', 'stock', 'tag',
]);
const RESERVED = RESERVED_URL_KEYS;

/** Minor units per major unit — mirrors lib/storefront/discovery.ts. */
const SCALE = 100;

/**
 * Constraints pinned by the ROUTE rather than chosen by the shopper — today,
 * a collection's own rule.
 *
 * Deliberately not readable or writable from the query string: a link to
 * /collections/under-50k must keep meaning "under ₦50,000" no matter what is
 * appended to it. Shopper filters are ANDed on top (see `criteriaToQuery`),
 * so a price filter can narrow the band but never widen past it, and
 * "clear all" returns to the collection, not to the whole catalogue.
 */
export interface DiscoveryScope {
  productIds?: string[];
  /** the order `productIds` were ranked in, when the route pinned a ranked
   *  set (a visual search result) rather than an editorial one */
  relevanceOrder?: string[];
  categoryPath?: string[];
  tag?: ProductTag;
  minPrice?: Money;
  maxPrice?: Money;
  minRating?: number;
  createdWithinDays?: number;
}

export interface DiscoveryCriteria {
  q?: string;
  categoryPath?: string[];
  brandSlugs: string[];
  /** internal option-value ids, resolved from readable URL keys. Spec filters
   *  ride here too, as `spec:<label>:<value>` — see SPEC_VALUE_PREFIX. */
  optionValueIds: string[];
  minPrice?: Money;
  maxPrice?: Money;
  minRating?: number;
  inStockOnly: boolean;
  tag?: ProductTag;
  sort: SortKey;
  page: number;
  /** pinned by the route; never encoded into the URL */
  scope?: DiscoveryScope;
}

export const EMPTY_CRITERIA: DiscoveryCriteria = {
  brandSlugs: [],
  optionValueIds: [],
  inStockOnly: false,
  sort: 'relevance',
  page: 1,
};

/* ─────────────────────────────── reading ────────────────────────────── */

/** `?brand=a&brand=b` and `?brand=a,b` both mean the same thing. */
function readList(raw: RawParams, key: string): string[] {
  const value = raw[key];
  if (value == null) return [];
  const parts = Array.isArray(value) ? value : [value];
  return [...new Set(parts.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))];
}

function readOne(raw: RawParams, key: string): string | undefined {
  const value = raw[key];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

/** Major-unit string → minor units. Rejects junk rather than coercing to NaN. */
function readMoney(raw: RawParams, key: string): Money | undefined {
  const value = readOne(raw, key);
  if (value == null) return undefined;
  const digits = value.replace(/[^0-9.]/g, '');
  // `Number('')` is 0, which would silently become "max price ₦0" and empty
  // the grid — treat anything non-numeric or non-positive as absent instead.
  if (!digits) return undefined;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * SCALE);
}

/**
 * URL → criteria. Unknown or malformed values are dropped, never thrown on:
 * a hand-edited or stale link should degrade to a broader search, not a 500.
 */
export function parseDiscoveryParams(
  raw: RawParams,
  index: OptionIndex,
  defaults: Partial<DiscoveryCriteria> = {},
): DiscoveryCriteria {
  const sort = readOne(raw, 'sort');
  const rating = Number(readOne(raw, 'rating'));
  const page = Number(readOne(raw, 'page'));
  const tag = readOne(raw, 'tag') as ProductTag | undefined;

  const optionValueIds: string[] = [];
  for (const entry of index) {
    if (RESERVED.has(entry.key)) continue;
    for (const key of readList(raw, entry.key)) {
      const match = entry.values.find((v) => v.key === key);
      if (match) optionValueIds.push(match.id);
    }
  }

  const q = readOne(raw, 'q');
  const hasQuery = Boolean(q);

  return {
    ...EMPTY_CRITERIA,
    ...defaults,
    q,
    brandSlugs: readList(raw, 'brand'),
    optionValueIds,
    minPrice: readMoney(raw, 'minPrice'),
    maxPrice: readMoney(raw, 'maxPrice'),
    minRating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
    inStockOnly: readOne(raw, 'stock') === '1',
    tag: tag && PRODUCT_TAGS.includes(tag) ? tag : undefined,
    // Relevance is only meaningful with a query; a bare listing defaults to
    // the merchandising order instead of pretending to rank by nothing.
    sort: sort && SORT_KEYS.has(sort)
      ? (sort as SortKey)
      : hasQuery
        ? 'relevance'
        : (defaults.sort ?? 'relevance'),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

/* ─────────────────────────────── writing ────────────────────────────── */

/**
 * Criteria → query string. Defaults are omitted so the canonical URL for an
 * unfiltered page is clean (`/c/fashion`, not `/c/fashion?page=1&sort=…`).
 */
export function toSearchParams(criteria: DiscoveryCriteria, index: OptionIndex): URLSearchParams {
  const params = new URLSearchParams();

  if (criteria.q) params.set('q', criteria.q);
  if (criteria.brandSlugs.length) params.set('brand', [...criteria.brandSlugs].sort().join(','));

  for (const entry of index) {
    const keys = entry.values.filter((v) => criteria.optionValueIds.includes(v.id)).map((v) => v.key);
    if (keys.length) params.set(entry.key, keys.sort().join(','));
  }

  if (criteria.minPrice != null) params.set('minPrice', String(criteria.minPrice / SCALE));
  if (criteria.maxPrice != null) params.set('maxPrice', String(criteria.maxPrice / SCALE));
  if (criteria.minRating != null) params.set('rating', String(criteria.minRating));
  if (criteria.inStockOnly) params.set('stock', '1');
  if (criteria.tag) params.set('tag', criteria.tag);

  if (criteria.sort !== 'relevance') params.set('sort', criteria.sort);
  if (criteria.page > 1) params.set('page', String(criteria.page));

  return params;
}

/**
 * Criteria → href.
 *
 * `pathname` may already carry query parameters the ROUTE owns and the codec
 * knows nothing about — `/search/image?vq=…` is the case that needs it: the
 * visual query is not a filter, but every filter, sort and pager link on that
 * page has to keep it or the shopper's first tap throws the search away.
 * Those are merged back in, and the codec always wins a collision so a pinned
 * value can never shadow a real filter.
 */
export function buildHref(pathname: string, criteria: DiscoveryCriteria, index: OptionIndex): string {
  const cut = pathname.indexOf('?');
  const path = cut === -1 ? pathname : pathname.slice(0, cut);
  const params = toSearchParams(criteria, index);

  if (cut !== -1) {
    for (const [key, value] of new URLSearchParams(pathname.slice(cut + 1))) {
      if (!params.has(key)) params.append(key, value);
    }
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Apply a change. Any edit other than paging returns to page 1 — staying on
 * page 7 of a result set that just shrank to two pages is the classic way to
 * strand a shopper on an empty grid.
 */
export function patchCriteria(
  criteria: DiscoveryCriteria,
  patch: Partial<DiscoveryCriteria>,
): DiscoveryCriteria {
  const next = { ...criteria, ...patch };
  if (!('page' in patch)) next.page = 1;
  return next;
}

/** Toggle one value in a multi-select facet (brand slug, option value id). */
export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Everything except the query and the category context the page is scoped to. */
export function clearFilters(criteria: DiscoveryCriteria): DiscoveryCriteria {
  return {
    ...EMPTY_CRITERIA,
    q: criteria.q,
    categoryPath: criteria.categoryPath,
    // The route's own constraint is not a filter the shopper put on, so
    // "clear all" on a collection page clears back to the collection.
    scope: criteria.scope,
    sort: criteria.sort,
  };
}

export function hasActiveFilters(criteria: DiscoveryCriteria): boolean {
  return (
    criteria.brandSlugs.length > 0 ||
    criteria.optionValueIds.length > 0 ||
    criteria.minPrice != null ||
    criteria.maxPrice != null ||
    criteria.minRating != null ||
    criteria.inStockOnly ||
    criteria.tag != null
  );
}

/* ──────────────────────── criteria → catalogue ──────────────────────── */

/**
 * The one place criteria become a catalogue query. The shapes are near
 * identical by design, so the future AI layer can hand `listProducts` a
 * ShoppingIntent through the very same door (see lib/ai/types.ts).
 */
export function criteriaToQuery(
  criteria: DiscoveryCriteria,
  opts: { store?: StoreScope; perPage?: number } = {},
): ListProductsParams {
  const scope = criteria.scope ?? {};

  /* Option ids and spec ids travel together in `optionValueIds`; this is the
   * one place they part company again. */
  const optionValueIds: string[] = [];
  const specs: Record<string, string[]> = {};
  for (const id of criteria.optionValueIds) {
    if (!id.startsWith(SPEC_VALUE_PREFIX)) {
      optionValueIds.push(id);
      continue;
    }
    const [, label, value] = id.split(SPEC_VALUE_PREFIX);
    if (!label || !value) continue;
    (specs[label] ??= []).push(value);
  }

  /* The scope is a ceiling, not a default: a shopper's price filter narrows
   * within it and can never escape it. */
  const minPrice = maxDefined(criteria.minPrice, scope.minPrice);
  const maxPrice = minDefined(criteria.maxPrice, scope.maxPrice);

  return {
    store: opts.store,
    query: criteria.q,
    categoryPath: criteria.categoryPath ?? scope.categoryPath,
    productIds: scope.productIds,
    relevanceOrder: scope.relevanceOrder,
    createdWithinDays: scope.createdWithinDays,
    brandSlugs: criteria.brandSlugs.length ? criteria.brandSlugs : undefined,
    optionValueIds: optionValueIds.length ? optionValueIds : undefined,
    specs: Object.keys(specs).length ? specs : undefined,
    minPrice,
    maxPrice,
    minRating: maxDefined(criteria.minRating, scope.minRating),
    inStockOnly: criteria.inStockOnly || undefined,
    tag: criteria.tag,
    tags: scope.tag ? [scope.tag] : undefined,
    sort: criteria.sort,
    page: criteria.page,
    perPage: opts.perPage,
  };
}

function maxDefined(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function minDefined(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}
