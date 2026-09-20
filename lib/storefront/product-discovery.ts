/*
 * lib/storefront/product-discovery.ts
 *
 * The Product Discovery Service — ONE engine behind every way a shopper
 * narrows the catalogue.
 *
 *     /search  ─┐
 *     /c/:path ─┼─▶  discoverProducts()  ─▶  catalog.ts  ─▶  fixtures
 *     /products ┘                                            (later: API/db)
 *     (later) AI assistant ─────────┘
 *
 * The point of routing all three pages through here is that filtering,
 * sorting, faceting, paging and the active-filter model are written once. A
 * category page is not a second search implementation; it is a search with a
 * category pinned. When the AI assistant lands it calls this same function
 * with criteria produced by lib/ai/intent.ts rather than by a URL.
 *
 * Server-only: it reads the catalogue.
 */
import {
  collectionQuery,
  getBrands,
  getBreadcrumb,
  getCategoryByPath,
  getCategoryTree,
  getChildCategories,
  getCollectionBySlug,
  getFeaturedCategories,
  getOptionIndex,
  listProducts,
} from './catalog';
import {
  buildHref,
  criteriaToQuery,
  hasActiveFilters,
  parseDiscoveryParams,
  patchCriteria,
  type DiscoveryCriteria,
  type DiscoveryScope,
  type RawParams,
} from './discovery-url';
import { getStoreCurrency } from './discovery';
import { formatMoney } from './format';
import type {
  Category,
  CategoryNode,
  Collection,
  ListProductsResult,
  Money,
  OptionIndex,
  Product,
  StoreScope,
} from './types';

export const RESULTS_PER_PAGE = 24;

/**
 * One removable filter, already resolved to a label and to the URL that
 * results from dropping it. Building the href here (rather than in the chip
 * component) keeps removal correct on the server render, so chips work before
 * hydration and on a shared link.
 */
export interface ActiveFilter {
  id: string;
  label: string;
  /** URL with this one filter removed */
  removeHref: string;
}

/** A one-tap price band, derived from the range the results actually span. */
export interface PricePreset {
  id: string;
  label: string;
  minPrice?: Money;
  maxPrice?: Money;
}

export interface DiscoveryView {
  criteria: DiscoveryCriteria;
  result: ListProductsResult;
  optionIndex: OptionIndex;
  currency: string;
  activeFilters: ActiveFilter[];
  /** price bands for the filter panel — computed here so the client filter
   *  component never has to import the catalogue to know what a sensible
   *  band is for this store */
  pricePresets: PricePreset[];
  /** URL with every filter dropped (query and category kept) */
  clearHref: string;
  /** the category this view is pinned to, if any */
  category: Category | null;
  /** direct children of that category, for the subcategory rail */
  childCategories: Category[];
  /** page URLs for the pager, index 0 = page 1 */
  pageHref: (page: number) => string;
}

export interface DiscoverOptions {
  /** tenant seam — carried into every catalogue read */
  store: StoreScope;
  criteria: DiscoveryCriteria;
  /** public path this view lives at, e.g. '/search' or '/c/fashion' */
  pathname: string;
  perPage?: number;
}

/**
 * Run a discovery query and return everything a results page needs.
 *
 * Deliberately one round trip's worth of work: the page awaits this once
 * rather than assembling five reads itself, which is what lets `/search`,
 * `/c/[...path]` and `/products` be thin.
 */
export async function discoverProducts(opts: DiscoverOptions): Promise<DiscoveryView> {
  const { store, criteria, pathname, perPage = RESULTS_PER_PAGE } = opts;

  const [optionIndex, category] = await Promise.all([
    getOptionIndex(store),
    criteria.categoryPath?.length ? getCategoryByPath(criteria.categoryPath) : Promise.resolve(null),
  ]);

  const result = await listProducts(criteriaToQuery(criteria, { store, perPage }));

  const [childCategories, storeCurrency] = await Promise.all([
    category ? getChildCategories(category.id) : Promise.resolve([]),
    // Read from the store rather than a constant so a merchant trading in
    // anything else formats correctly — and so price chips still have a
    // currency when the result set is empty.
    getStoreCurrency(store),
  ]);
  const currency = result.items[0]?.currency ?? storeCurrency;

  const href = (next: DiscoveryCriteria) => buildHref(pathname, next, optionIndex);

  return {
    criteria,
    result,
    optionIndex,
    currency,
    activeFilters: buildActiveFilters(criteria, optionIndex, currency, href),
    pricePresets: buildPricePresets(result.facets.priceMin, result.facets.priceMax, currency),
    clearHref: href({
      ...criteria,
      brandSlugs: [],
      optionValueIds: [],
      minPrice: undefined,
      maxPrice: undefined,
      minRating: undefined,
      inStockOnly: false,
      tag: undefined,
      page: 1,
    }),
    category,
    childCategories,
    pageHref: (page: number) => href(patchCriteria(criteria, { page })),
  };
}

/**
 * Bands cut from the range the current results actually span, not fixed
 * tiers: a store selling ₦4,000 pantry goods and one selling ₦1.6m laptops
 * both get bands a shopper would recognise, and "Under ₦50k" is never
 * offered on a page where everything costs more than that.
 */
export function buildPricePresets(min: Money, max: Money, currency: string): PricePreset[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];

  const cuts = [0.25, 0.5, 0.75]
    .map((q) => roundToNiceNumber(min + (max - min) * q))
    .filter((c, i, all) => c > min && c < max && all.indexOf(c) === i)
    .sort((a, b) => a - b);
  if (!cuts.length) return [];

  const presets: PricePreset[] = [
    { id: `under-${cuts[0]}`, label: `Under ${formatMoney(cuts[0], currency)}`, maxPrice: cuts[0] },
  ];
  for (let i = 1; i < cuts.length; i++) {
    presets.push({
      id: `${cuts[i - 1]}-${cuts[i]}`,
      label: `${formatMoney(cuts[i - 1], currency)} – ${formatMoney(cuts[i], currency)}`,
      minPrice: cuts[i - 1],
      maxPrice: cuts[i],
    });
  }
  const last = cuts[cuts.length - 1];
  presets.push({ id: `over-${last}`, label: `${formatMoney(last, currency)} & up`, minPrice: last });
  return presets;
}

/** 143,720 → 150,000 — keeps band labels readable instead of exact quantiles. */
function roundToNiceNumber(minor: Money): Money {
  const major = minor / 100;
  const magnitude = Math.pow(10, Math.max(0, String(Math.floor(major)).length - 2));
  return Math.max(magnitude, Math.ceil(major / magnitude) * magnitude) * 100;
}

/** Chips for everything currently narrowing the results. */
function buildActiveFilters(
  criteria: DiscoveryCriteria,
  optionIndex: OptionIndex,
  currency: string,
  href: (next: DiscoveryCriteria) => string,
): ActiveFilter[] {
  const chips: ActiveFilter[] = [];

  for (const slug of criteria.brandSlugs) {
    chips.push({
      id: `brand:${slug}`,
      // Brand slugs are lowercase kebab; title-case them for display. The
      // facet list carries proper names, but a brand can be filtered on
      // without appearing in the current (already narrowed) facet pool.
      label: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      removeHref: href(
        patchCriteria(criteria, { brandSlugs: criteria.brandSlugs.filter((b) => b !== slug) }),
      ),
    });
  }

  for (const entry of optionIndex) {
    for (const value of entry.values) {
      if (!criteria.optionValueIds.includes(value.id)) continue;
      chips.push({
        id: `opt:${value.id}`,
        // A variant value speaks for itself ("Black"); a spec value often
        // doesn't ("Slim", "USB-C"), so it carries its label.
        label: entry.source === 'spec' ? `${entry.name}: ${value.label}` : value.label,
        removeHref: href(
          patchCriteria(criteria, {
            optionValueIds: criteria.optionValueIds.filter((id) => id !== value.id),
          }),
        ),
      });
    }
  }

  if (criteria.minPrice != null || criteria.maxPrice != null) {
    const { minPrice, maxPrice } = criteria;
    chips.push({
      id: 'price',
      label:
        minPrice != null && maxPrice != null
          ? `${formatMoney(minPrice, currency)} – ${formatMoney(maxPrice, currency)}`
          : maxPrice != null
            ? `Under ${formatMoney(maxPrice, currency)}`
            : `${formatMoney(minPrice!, currency)} & up`,
      removeHref: href(patchCriteria(criteria, { minPrice: undefined, maxPrice: undefined })),
    });
  }

  if (criteria.minRating != null) {
    chips.push({
      id: 'rating',
      label: `${criteria.minRating} stars & up`,
      removeHref: href(patchCriteria(criteria, { minRating: undefined })),
    });
  }

  if (criteria.inStockOnly) {
    chips.push({
      id: 'stock',
      label: 'In stock',
      removeHref: href(patchCriteria(criteria, { inStockOnly: false })),
    });
  }

  if (criteria.tag) {
    chips.push({
      id: 'tag',
      label: criteria.tag.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      removeHref: href(patchCriteria(criteria, { tag: undefined })),
    });
  }

  return chips;
}

/**
 * What to offer when a search returns nothing.
 *
 * Every suggestion is checked against the catalogue before it is offered —
 * "try removing a filter" is only shown when doing so genuinely finds
 * products, and the broader query is only suggested when it genuinely
 * matches. Offering a recovery path that leads to a second empty page is
 * worse than offering none.
 */
export interface EmptyStateOptions {
  /** dropping every filter but keeping the query — null if that is also empty */
  withoutFilters: { href: string; total: number } | null;
  /** the first word of a multi-word query, if it alone finds products */
  broaderQuery: { term: string; href: string; total: number } | null;
}

export async function getEmptyStateOptions(
  opts: DiscoverOptions & { optionIndex: OptionIndex },
): Promise<EmptyStateOptions> {
  const { store, criteria, pathname, optionIndex } = opts;
  const href = (next: DiscoveryCriteria) => buildHref(pathname, next, optionIndex);

  let withoutFilters: EmptyStateOptions['withoutFilters'] = null;
  if (hasActiveFilters(criteria)) {
    const relaxed: DiscoveryCriteria = {
      ...criteria,
      brandSlugs: [],
      optionValueIds: [],
      minPrice: undefined,
      maxPrice: undefined,
      minRating: undefined,
      inStockOnly: false,
      tag: undefined,
      page: 1,
    };
    const { total } = await listProducts(criteriaToQuery(relaxed, { store, perPage: 1 }));
    if (total > 0) withoutFilters = { href: href(relaxed), total };
  }

  let broaderQuery: EmptyStateOptions['broaderQuery'] = null;
  const words = criteria.q?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length > 1) {
    // The last word is usually the noun ("black sneakers" → "sneakers").
    const term = words[words.length - 1];
    const simpler: DiscoveryCriteria = {
      ...criteria,
      q: term,
      brandSlugs: [],
      optionValueIds: [],
      minPrice: undefined,
      maxPrice: undefined,
      minRating: undefined,
      inStockOnly: false,
      tag: undefined,
      page: 1,
    };
    const { total } = await listProducts(criteriaToQuery(simpler, { store, perPage: 1 }));
    if (total > 0) broaderQuery = { term, href: href(simpler), total };
  }

  return { withoutFilters, broaderQuery };
}


/* ───────────────────────── category landing ─────────────────────────── */

/** A child category with a real count behind it. */
export interface CategoryChild extends Category {
  productCount: number;
}

export interface CategoryLanding {
  category: Category;
  /** root → … → this category, for breadcrumbs */
  chain: Category[];
  /** direct children, empty for a leaf */
  children: CategoryChild[];
  /**
   * Where a leaf has no children of its own, its siblings keep the sideways
   * move available — landing on "Skirts" and finding no way across to
   * "Dresses" without going back up is the dead end this avoids.
   */
  siblings: CategoryChild[];
  /** a short best-selling rail, for the top of the page */
  popular: Product[];
}

/**
 * Everything a category landing page needs beyond the results themselves.
 *
 * Counts come from real queries, never from a stored number, so a child chip
 * reading "14" is 14 products the shopper can actually reach. Children with
 * nothing behind them are dropped rather than shown as empty rails.
 */
export async function getCategoryLanding(opts: {
  store: StoreScope;
  category: Category;
  popularLimit?: number;
}): Promise<CategoryLanding> {
  const { store, category, popularLimit = 6 } = opts;

  const [chain, rawChildren, popular] = await Promise.all([
    getBreadcrumb(category),
    getChildCategories(category.id),
    listProducts({
      store,
      categoryPath: category.path,
      sort: 'bestselling',
      perPage: popularLimit,
    }).then((r) => r.items),
  ]);

  const withCounts = async (categories: Category[]): Promise<CategoryChild[]> => {
    const counted = await Promise.all(
      categories.map(async (c) => {
        const { total } = await listProducts({ store, categoryPath: c.path, perPage: 1 });
        return { ...c, productCount: total };
      }),
    );
    return counted.filter((c) => c.productCount > 0);
  };

  const children = await withCounts(rawChildren);

  let siblings: CategoryChild[] = [];
  if (!children.length && category.parentId) {
    const all = await getChildCategories(category.parentId);
    siblings = await withCounts(all.filter((c) => c.id !== category.id));
  }

  return { category, chain, children, siblings, popular };
}

/* ──────────────────────────── collections ───────────────────────────── */

export interface CollectionLanding {
  collection: Collection;
  /** the short editorial rail above the full grid */
  highlights: Product[];
  /** total members, before any shopper filter */
  productCount: number;
}

/**
 * The editorial top of a collection page.
 *
 * Highlights are the collection's own opening run in its own order (a curated
 * list keeps the editor's sequence; a dynamic one takes its natural sort), so
 * the rail is a genuine "start here" rather than a second copy of the grid.
 */
export async function getCollectionLanding(opts: {
  store: StoreScope;
  collection: Collection;
  limit?: number;
}): Promise<CollectionLanding> {
  const { store, collection, limit = 6 } = opts;
  const query = collectionQuery(collection);

  const [{ items }, { total }] = await Promise.all([
    listProducts({ ...query, store, sort: collection.sort, perPage: limit }),
    listProducts({ ...query, store, perPage: 1 }),
  ]);

  return { collection, highlights: items, productCount: total };
}

/**
 * Resolve a collection slug to the scope its page pins.
 *
 * Returns null for an unknown slug so the route can 404 rather than quietly
 * showing the whole catalogue — a collection URL that renders "everything" is
 * indistinguishable from a working one, which is the worst kind of broken.
 */
export async function resolveCollectionScope(
  slug: string,
  store: StoreScope,
): Promise<{ collection: Collection; scope: DiscoveryScope } | null> {
  const collection = await getCollectionBySlug(slug, store);
  if (!collection) return null;

  const { rule } = collection;
  const scope: DiscoveryScope =
    rule.kind === 'curated'
      ? { productIds: rule.productIds ?? [] }
      : {
          categoryPath: rule.match?.categoryPath,
          tag: rule.match?.tag,
          minPrice: rule.match?.minPrice,
          maxPrice: rule.match?.maxPrice,
          minRating: rule.match?.minRating,
          createdWithinDays: rule.match?.createdWithinDays,
        };

  return { collection, scope };
}

/* ─────────────────────── page-level convenience ─────────────────────── */

export interface DiscoveryPage {
  view: DiscoveryView;
  emptyState: EmptyStateOptions;
  /** real departments to offer when nothing matched */
  emptyCategories: Category[];
}

/**
 * Everything a results route needs, in one await.
 *
 * The empty-state options are only computed when the result set is actually
 * empty — they cost extra catalogue reads (and, later, extra API calls), and
 * paying for them on every successful search would be waste.
 */
export async function loadDiscoveryPage(opts: {
  organizationSlug: string;
  rawParams: RawParams;
  pathname: string;
  /** criteria the route pins regardless of the URL, e.g. a category path */
  defaults?: Partial<DiscoveryCriteria>;
  perPage?: number;
}): Promise<DiscoveryPage> {
  const store: StoreScope = { organizationSlug: opts.organizationSlug };
  const optionIndex = await getOptionIndex(store);
  const criteria = parseDiscoveryParams(opts.rawParams, optionIndex, opts.defaults);

  const view = await discoverProducts({
    store,
    criteria,
    pathname: opts.pathname,
    perPage: opts.perPage,
  });

  if (view.result.total > 0) {
    return { view, emptyState: { withoutFilters: null, broaderQuery: null }, emptyCategories: [] };
  }

  const [emptyState, emptyCategories] = await Promise.all([
    getEmptyStateOptions({ store, criteria, pathname: opts.pathname, optionIndex }),
    getFeaturedCategories(),
  ]);

  return { view, emptyState, emptyCategories };
}

/**
 * Seed content for /search with no query.
 *
 * "Popular searches" are this store's busiest departments and brands, so
 * every chip returns products. A hardcoded list of trendy nouns would
 * eventually advertise things the merchant doesn't sell.
 */
export async function getSearchLandingContent(store: StoreScope): Promise<{
  popularSearches: string[];
  categories: Category[];
  trending: Product[];
}> {
  const [tree, brands, bestsellers] = await Promise.all([
    getCategoryTree(),
    getBrands(),
    listProducts({ store, sort: 'bestselling', perPage: 8 }),
  ]);

  const roots = tree.filter((c) => c.productCount > 0).sort((a, b) => b.productCount - a.productCount);

  // Busiest leaf departments make the most natural search terms.
  const leaves: { name: string; count: number }[] = [];
  const walk = (nodes: CategoryNode[]) => {
    for (const node of nodes) {
      if (node.children.length) walk(node.children);
      else if (node.productCount > 0) leaves.push({ name: node.name, count: node.productCount });
    }
  };
  walk(tree);

  const popularSearches = [
    ...leaves.sort((a, b) => b.count - a.count).slice(0, 5).map((l) => l.name),
    ...brands.slice(0, 3).map((b) => b.name),
  ];

  return {
    popularSearches,
    categories: roots.slice(0, 10),
    trending: bestsellers.items,
  };
}
