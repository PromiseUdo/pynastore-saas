/*
 * lib/storefront/catalog.ts
 *
 * The storefront's data access layer. Every page/component imports data
 * from HERE — never from `./data/*` directly.
 *
 * Each function resolves the CURRENT STORE first (see ./data/current.ts):
 * either from the `store` scope a caller passes — API routes must, since
 * proxy.ts skips /api — or from the tenant header the proxy stamps on a
 * page request. The query engine then runs over that one store's
 * catalogue, so a filter, a search or a facet can only ever describe the
 * merchant whose domain was asked for.
 *
 * Server-only: it reaches Prisma through ./data/from-prisma.ts. Pure
 * helpers that client components need live in ./product-helpers.ts.
 */
import type {
  Brand,
  Category,
  CategoryNode,
  Collection,
  CollectionSummary,
  DeliveryPromise,
  FacetBucket,
  HomepageSections,
  ListProductsParams,
  ListProductsResult,
  OptionIndex,
  OptionIndexEntry,
  StoreScope,
  Product,
  ProductFacets,
  ProductQuestion,
  ProductTag,
  Review,
  SortKey,
} from './types';
import { normalise, rankProducts, tokenize } from './search';
import { sortReviews, type ReviewSort } from './reviews/rules';
import { collectionQuery, specValueId, urlKey } from './product-helpers';
import { getCatalogue, resolveStoreSlug } from './data/current';
import { loadStorePage, loadStorePageLinks, type PublishedStorePage } from './data/pages';
import { isValidPageSlug, type StorePageLink } from './pages/rules';
import type { Catalogue } from './data/catalogue';
import { deliveryOverview } from './delivery/quote';
import { loadLiveAnnouncements } from './data/announcements';
import { loadStorefrontLook, type StorefrontLook } from './data/appearance';
import type { Announcement } from '@/lib/marketing/announcement';

export type { PublishedStorePage } from './data/pages';
export type { StorePageLink } from './pages/rules';
export type { StorefrontLook } from './data/appearance';

export {
  specValueId,
  parseSpecValueId,
  urlKey,
  collectionQuery,
  findVariant,
  defaultVariant,
  variantImage,
  optionSummary,
} from './product-helpers';

const DEFAULT_PER_PAGE = 12;

/* simulate async so swapping in real IO later is transparent */
async function ok<T>(value: T): Promise<T> {
  return value;
}

/* ---------------- categories ---------------- */

export async function getCategoryTree(scope?: StoreScope): Promise<CategoryNode[]> {
  const cat = await getCatalogue(scope);
  const counts = productCountsByCategory(cat);
  const build = (parentId: string | null): CategoryNode[] =>
    cat.categories
      .filter((c) => c.parentId === parentId)
      .map((c) => ({ ...c, children: build(c.id), productCount: counts.get(c.id) ?? 0 }));
  return ok(build(null));
}

export async function getFeaturedCategories(scope?: StoreScope): Promise<Category[]> {
  const cat = await getCatalogue(scope);
  return ok(cat.categories.filter((c) => c.featured && c.level === 0));
}

export async function getCategoryByPath(segments: string[], scope?: StoreScope): Promise<Category | null> {
  if (!segments.length) return ok(null);
  const cat = await getCatalogue(scope);
  const leaf = cat.categoryBySlug.get(segments[segments.length - 1]);
  if (!leaf) return ok(null);
  // the slug path must match exactly (guards against ambiguous slugs)
  if (leaf.path.join('/') !== segments.join('/')) return ok(null);
  return ok(leaf);
}

export async function getCategoryBySlug(slug: string, scope?: StoreScope): Promise<Category | null> {
  const cat = await getCatalogue(scope);
  return ok(cat.categoryBySlug.get(slug) ?? null);
}

export async function getCategoryById(id: string, scope?: StoreScope): Promise<Category | null> {
  const cat = await getCatalogue(scope);
  return ok(cat.categoryById.get(id) ?? null);
}

export async function getBreadcrumb(category: Category, scope?: StoreScope): Promise<Category[]> {
  const cat = await getCatalogue(scope);
  const chain: Category[] = [];
  let current: Category | undefined = category;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.parentId ? cat.categoryById.get(current.parentId) : undefined;
  }
  return ok(chain);
}

/** Direct children of a category (for subcategory chips). */
export async function getChildCategories(categoryId: string, scope?: StoreScope): Promise<Category[]> {
  const cat = await getCatalogue(scope);
  return ok(cat.categories.filter((c) => c.parentId === categoryId));
}

/** Every category name on a product's path — what a text search matches
 *  "shoes"/"laptops" against, since that lives on the category, not the row. */
function categoryNamesOf(cat: Catalogue) {
  return (product: Product): string[] =>
    product.categoryIds.map((id) => cat.categoryById.get(id)?.name).filter((n): n is string => Boolean(n));
}

function productCountsByCategory(cat: Catalogue): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of cat.products) {
    for (const cid of p.categoryIds) counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  return counts;
}

/* ---------------- brands ---------------- */

export async function getBrands(scope?: StoreScope): Promise<Brand[]> {
  const cat = await getCatalogue(scope);
  return ok(cat.brands);
}
export async function getBrand(slug: string, scope?: StoreScope): Promise<Brand | null> {
  const cat = await getCatalogue(scope);
  return ok(cat.brandBySlug.get(slug) ?? null);
}
export async function getBrandById(id: string, scope?: StoreScope): Promise<Brand | null> {
  const cat = await getCatalogue(scope);
  return ok(cat.brandById.get(id) ?? null);
}

/* ---------------- product listing ---------------- */

/**
 * `relevanceRank` carries the text-search ordering produced by
 * lib/storefront/search.ts. Without a query there is no relevance signal, so
 * "relevance" falls back to a stable merchandising order (best-selling,
 * in-stock first) rather than fixture order, which is arbitrary.
 */
function sortProducts(items: Product[], sort: SortKey, relevanceRank?: Map<string, number>): Product[] {
  const copy = [...items];
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    case 'price-asc':
      return copy.sort((a, b) => a.priceFrom - b.priceFrom);
    case 'price-desc':
      return copy.sort((a, b) => b.priceTo - a.priceTo);
    case 'rating':
      return copy.sort((a, b) => b.rating.average - a.rating.average || b.rating.count - a.rating.count);
    case 'bestselling':
      return copy.sort((a, b) => b.soldCount - a.soldCount || b.rating.count - a.rating.count);
    case 'relevance':
    default:
      if (relevanceRank) {
        return copy.sort(
          (a, b) => (relevanceRank.get(a.id) ?? Infinity) - (relevanceRank.get(b.id) ?? Infinity),
        );
      }
      return copy.sort(
        (a, b) =>
          Number(b.inStock) - Number(a.inStock) ||
          b.soldCount - a.soldCount ||
          a.id.localeCompare(b.id),
      );
  }
}

function computeFacets(cat: Catalogue, pool: Product[]): ProductFacets {
  const prices = pool.flatMap((p) => [p.priceFrom, p.priceTo]);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;

  const brandCounts = new Map<string, number>();
  // A product without a brand simply doesn't offer that filter.
  for (const p of pool) if (p.brandId) brandCounts.set(p.brandId, (brandCounts.get(p.brandId) ?? 0) + 1);
  const brands: FacetBucket[] = [...brandCounts.entries()]
    .flatMap(([id, count]) => {
      const b = cat.brandById.get(id);
      return b ? [{ value: b.slug, label: b.name, count }] : [];
    })
    .sort((a, b) => b.count - a.count);

  const optionMap = new Map<string, { kind: 'color' | 'size' | 'select'; buckets: Map<string, FacetBucket> }>();
  for (const p of pool) {
    for (const opt of p.options) {
      if (!optionMap.has(opt.name)) optionMap.set(opt.name, { kind: opt.kind, buckets: new Map() });
      const entry = optionMap.get(opt.name)!;
      for (const val of opt.values) {
        const existing = entry.buckets.get(val.id);
        if (existing) existing.count++;
        else entry.buckets.set(val.id, { value: val.id, label: val.label, count: 1, swatch: val.swatch });
      }
    }
  }
  const options: ProductFacets['options'] = [...optionMap.entries()].map(
    ([name, { kind, buckets }]) => ({
      name,
      kind,
      source: 'option' as const,
      buckets: [...buckets.values()],
    }),
  );

  /*
   * Spec facets. Only labels in the catalogue's facetable set appear — a label whose values
   * are effectively unique per product ("Dimensions: 143 × 67 × 88 cm") makes
   * a filter nobody can use, and a single-valued one ("Warranty: 24 months")
   * narrows nothing. Which of them show up on a given page is then decided by
   * the pool: Fit on shirts, Connectivity on laptops, Material on bags.
   */
  const specMap = new Map<string, Map<string, FacetBucket>>();
  for (const p of pool) {
    for (const spec of p.specs) {
      if (!cat.facetableSpecs.has(spec.label)) continue;
      if (!specMap.has(spec.label)) specMap.set(spec.label, new Map());
      const buckets = specMap.get(spec.label)!;
      const value = specValueId(spec.label, spec.value);
      const existing = buckets.get(value);
      if (existing) existing.count++;
      else buckets.set(value, { value, label: spec.value, count: 1 });
    }
  }
  for (const [label, buckets] of specMap) {
    options.push({
      name: label,
      kind: 'select' as const,
      source: 'spec' as const,
      buckets: [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label)),
    });
  }

  /* Ratings need reviews. Until this store has any, the filter is dropped
   * rather than offered as a row of zeroes that can only return nothing. */
  const ratings: FacetBucket[] = cat.hasRatings
    ? [4, 3, 2, 1].map((min) => ({
        value: String(min),
        label: `${min} stars & up`,
        count: pool.filter((p) => p.rating.average >= min).length,
      }))
    : [];

  return { priceMin, priceMax, brands, options, ratings };
}

export async function listProducts(params: ListProductsParams = {}): Promise<ListProductsResult> {
  const {
    store,
    categoryPath,
    brandSlugs,
    minPrice,
    maxPrice,
    optionValueIds,
    specs,
    minRating,
    inStockOnly,
    tag,
    tags,
    productIds,
    createdWithinDays,
    relevanceOrder,
    query,
    sort = 'relevance',
    page = 1,
    perPage = DEFAULT_PER_PAGE,
  } = params;

  const cat = await getCatalogue(store);
  let pool = [...cat.products];

  /*
   * A curated collection's membership. Applied before everything else so the
   * facets, counts and price bands below all describe the collection rather
   * than the store — which is what makes the filter rail on a collection page
   * offer only what that collection contains.
   */
  if (productIds) {
    const wanted = new Set(productIds);
    pool = pool.filter((p) => wanted.has(p.id));
  }

  if (typeof createdWithinDays === 'number') {
    const cutoff = Date.now() - createdWithinDays * 86_400_000;
    pool = pool.filter((p) => +new Date(p.createdAt) >= cutoff);
  }

  if (categoryPath?.length) {
    const category = cat.categoryBySlug.get(categoryPath[categoryPath.length - 1]);
    if (category) {
      const ids = new Set(cat.subtreeIds(category.id));
      pool = pool.filter((p) => p.categoryIds.some((c) => ids.has(c)));
    } else {
      pool = [];
    }
  }

  /*
   * Text search runs through the relevance engine rather than a substring
   * scan: it matches name/brand/category/tag/option/description with
   * per-field weights, folds plurals, and keeps the ranking so a
   * sort=relevance request can restore it after the filters below.
   */
  let relevanceRank: Map<string, number> | undefined;
  let searchMeta: ListProductsResult['search'];
  if (query?.trim()) {
    const outcome = rankProducts(pool, query, categoryNamesOf(cat));
    pool = outcome.hits.map((h) => h.product);
    relevanceRank = new Map(pool.map((p, i) => [p.id, i]));
    searchMeta = { terms: outcome.terms, partial: outcome.partial };
  } else if (relevanceOrder?.length) {
    /* An external ranker's order (today: visual similarity) standing in for
     * the text engine's. Same mechanism, so `sort=relevance` keeps it and
     * every other sort overrides it, exactly as with a typed query. */
    relevanceRank = new Map(relevanceOrder.map((id, i) => [id, i]));
  }

  // `tag` is the single-tag shorthand; `tags` (e.g. a collection's rule plus a
  // shopper's chip) must ALL be present.
  const requiredTags: ProductTag[] = [...(tag ? [tag] : []), ...(tags ?? [])];
  if (requiredTags.length) pool = pool.filter((p) => requiredTags.every((t) => p.tags.includes(t)));

  // facets computed from the category/query/tag pool, before price/brand/option refinement
  const facets = computeFacets(cat, pool);

  if (brandSlugs?.length) {
    const set = new Set(brandSlugs);
    pool = pool.filter((p) => set.has(cat.brandById.get(p.brandId)?.slug ?? ''));
  }
  if (typeof minPrice === 'number') pool = pool.filter((p) => p.priceTo >= minPrice);
  if (typeof maxPrice === 'number') pool = pool.filter((p) => p.priceFrom <= maxPrice);
  if (minRating) pool = pool.filter((p) => p.rating.average >= minRating);
  if (inStockOnly) pool = pool.filter((p) => p.inStock);

  if (optionValueIds?.length) {
    // group requested values by their option name → AND across options, OR within
    const byOption = new Map<string, Set<string>>();
    for (const p of cat.products) {
      for (const opt of p.options) {
        for (const v of opt.values) {
          if (optionValueIds.includes(v.id)) {
            if (!byOption.has(opt.name)) byOption.set(opt.name, new Set());
            byOption.get(opt.name)!.add(v.id);
          }
        }
      }
    }
    pool = pool.filter((p) => {
      const productValueIds = new Set(p.options.flatMap((o) => o.values.map((v) => v.id)));
      return [...byOption.values()].every((wanted) => [...wanted].some((id) => productValueIds.has(id)));
    });
  }

  if (specs) {
    for (const [label, wanted] of Object.entries(specs)) {
      if (!wanted.length) continue;
      pool = pool.filter((p) =>
        p.specs.some((sp) => sp.label === label && wanted.includes(sp.value)),
      );
    }
  }

  const sorted = sortProducts(pool, sort, relevanceRank);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const items = sorted.slice((safePage - 1) * perPage, safePage * perPage);

  return ok({ items, total, page: safePage, perPage, pageCount, facets, search: searchMeta });
}

/* ---------------- single product ---------------- */

export async function getProductBySlug(slug: string, scope?: StoreScope): Promise<Product | null> {
  const cat = await getCatalogue(scope);
  return ok(cat.productBySlug.get(slug) ?? null);
}
export async function getProductById(id: string, scope?: StoreScope): Promise<Product | null> {
  const cat = await getCatalogue(scope);
  return ok(cat.productById.get(id) ?? null);
}
export async function getProductsByIds(ids: string[], scope?: StoreScope): Promise<Product[]> {
  const cat = await getCatalogue(scope);
  return ok(ids.map((id) => cat.productById.get(id)).filter((p): p is Product => Boolean(p)));
}

export async function getRelatedProducts(productId: string, limit = 8, scope?: StoreScope): Promise<Product[]> {
  const cat = await getCatalogue(scope);
  const product = cat.productById.get(productId);
  if (!product) return ok([]);
  const related = product.relatedIds.map((id) => cat.productById.get(id)).filter((p): p is Product => Boolean(p));
  if (related.length >= limit) return ok(related.slice(0, limit));
  const filler = cat.products.filter(
    (p) => p.id !== productId && p.categoryIds.includes(product.categoryIds[0]) && !product.relatedIds.includes(p.id),
  );
  return ok([...related, ...filler].slice(0, limit));
}

/**
 * Products customers of THIS store actually bought alongside this one —
 * shared accepted orders or invoices, at least two of them (see
 * ./data/bought-together.ts). Resolved through the catalogue, so only
 * published, in-stock products come back. Empty until the store has sales;
 * nothing stands in for the real signal.
 */
export async function getFrequentlyBoughtTogether(
  productId: string,
  limit = 8,
  scope?: StoreScope,
): Promise<{ product: Product; baskets: number }[]> {
  const cat = await getCatalogue(scope);
  if (!cat.productById.has(productId)) return [];
  const pairs = await cat.boughtTogether(productId);
  return pairs
    .map(({ productId: id, baskets }) => ({ product: cat.productById.get(id), baskets }))
    .filter((e): e is { product: Product; baskets: number } => Boolean(e.product?.inStock))
    .slice(0, limit);
}

/**
 * A category's "goes well with" categories as the merchant set them, best
 * first, or null when they haven't. Only categories the shopper can reach.
 */
export async function getCompanionCategories(
  categoryId: string,
  scope?: StoreScope,
): Promise<{ title: string | null; categories: Category[] } | null> {
  const cat = await getCatalogue(scope);
  const rule = cat.companionsFor(categoryId);
  if (!rule) return null;
  return {
    title: rule.title,
    categories: rule.categoryIds.map((id) => cat.categoryById.get(id)).filter((c): c is Category => Boolean(c)),
  };
}

/* ---------------- reviews ---------------- */

/**
 * A product's reviews, sorted and paged.
 *
 * Where they come from is the catalogue's business (see `reviewsFor` on
 * lib/storefront/data/catalogue.ts): the merchant's own records, and nothing
 * else — a shopper is never shown an invented opinion of a product. The
 * product is looked up in this store's catalogue first, so an id from
 * another merchant's shop returns nothing rather than their reviews.
 */
export async function getReviews(
  productId: string,
  opts: { sort?: ReviewSort; page?: number; perPage?: number } = {},
  scope?: StoreScope,
): Promise<{ items: Review[]; total: number; page: number; pageCount: number }> {
  const cat = await getCatalogue(scope);
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.max(1, opts.perPage ?? 10);

  if (!cat.productById.has(productId)) {
    return ok({ items: [], total: 0, page, pageCount: 1 });
  }

  const all = sortReviews(await cat.reviewsFor(productId), opts.sort ?? 'recent');
  const start = (page - 1) * perPage;

  return ok({
    items: all.slice(start, start + perPage),
    total: all.length,
    page,
    pageCount: Math.max(1, Math.ceil(all.length / perPage)),
  });
}

/* ---------------- questions & answers ---------------- */

/**
 * Customer Q&A for a product: the questions shoppers asked and the merchant
 * answered, newest answer first.
 *
 * Only answered ones cross this seam — see `questionsFor` on the catalogue
 * (./data/catalogue.ts). A question still waiting is the merchant's to deal
 * with (Sales → Questions), and the shopper who asked it sees their own
 * through ./questions/read.ts rather than through the catalogue.
 */
export async function getProductQuestions(
  productId: string,
  scope?: StoreScope,
): Promise<ProductQuestion[]> {
  const cat = await getCatalogue(scope);
  return ok(await cat.questionsFor(productId));
}

/* ---------------- delivery ---------------- */

/**
 * What this store promises about delivery and returns.
 *
 * Built from the merchant's own delivery zones and pickup points, and the
 * return window they set (Settings → Delivery & returns) — the same window
 * the account page enforces when a shopper asks to send something back — so
 * the product page can't promise something checkout or returns then
 * contradicts. The exact price depends on the address, which only checkout
 * knows, and the page says so.
 */
export async function getDeliveryPromise(scope?: StoreScope): Promise<DeliveryPromise> {
  const cat = await getCatalogue(scope);
  const [options, pages] = await Promise.all([deliveryOverview(cat.organizationSlug), getStorePages(scope)]);
  const policy = pages.find((page) => page.kind === 'DELIVERY_RETURNS');

  return ok({
    options,
    returnWindowDays: cat.returnWindowDays,
    pickupAvailable: options.some((o) => o.kind === 'pickup'),
    currency: cat.currency,
    policyPage: policy ? { title: policy.title, href: policy.href } : null,
  });
}

/* ---------------- search ---------------- */

export async function searchProducts(query: string, opts: Omit<ListProductsParams, 'query'> = {}) {
  return listProducts({ ...opts, query, sort: opts.sort ?? 'relevance' });
}

/**
 * Autocomplete. Products come from the same ranking engine the results page
 * uses, so the top suggestion for a query is the top result for it — a
 * separate name-only matcher would quietly disagree with the page it leads to.
 *
 * Categories and brands match on a normalised prefix/substring, which is what
 * makes "bla" offer the Black colourway and "elec" offer Electronics.
 */
export async function getSearchSuggestions(
  query: string,
  opts: { store?: StoreScope; limit?: number } = {},
): Promise<{
  products: Product[];
  categories: Category[];
  brands: Brand[];
  /** query completions drawn from real catalogue nouns, e.g. "black" → "Black · Shoes" */
  terms: string[];
}> {
  const limit = opts.limit ?? 6;
  const terms = tokenize(query);
  if (!terms.length) return ok({ products: [], categories: [], brands: [], terms: [] });

  const cat = await getCatalogue(opts.store);
  const norm = normalise(query);
  const hits = (name: string) => normalise(name).includes(norm);

  const { hits: ranked } = rankProducts(cat.products, query, categoryNamesOf(cat));

  /*
   * Completions are built from categories the shopper is evidently heading
   * for, paired with the term they typed — never invented. Capped tightly:
   * the brief asks for a clean autocomplete, not a wall of guesses.
   */
  const matchingCategories = cat.categories.filter((c) => hits(c.name));
  const completions = matchingCategories.length
    ? []
    : [...new Set(ranked.slice(0, 12).map((h) => cat.categoryById.get(h.product.categoryId)?.name))]
        .filter((n): n is string => Boolean(n))
        .slice(0, 3)
        .map((n) => `${query.trim()} ${n.toLowerCase()}`);

  return ok({
    products: ranked.slice(0, limit).map((h) => h.product),
    categories: matchingCategories.sort((a, b) => a.level - b.level).slice(0, 4),
    brands: cat.brands.filter((b) => hits(b.name)).slice(0, 4),
    terms: completions,
  });
}

/* ---------------- option filter index ---------------- */

/**
 * Maps opaque option-value ids to readable URL keys, so a filtered search is
 * `?colour=black&size=m` rather than `?opt=ov_col_black`. Derived from the
 * catalogue's own options — nothing here is a hardcoded colour list, so a
 * merchant selling by Voltage gets `?voltage=…` for free.
 */
export async function getOptionIndex(scope?: StoreScope): Promise<OptionIndex> {
  const cat = await getCatalogue(scope);
  const byName = new Map<string, OptionIndexEntry>();

  for (const product of cat.products) {
    for (const opt of product.options) {
      let entry = byName.get(opt.name);
      if (!entry) {
        entry = { key: urlKey(opt.name), name: opt.name, kind: opt.kind, source: 'option', values: [] };
        byName.set(opt.name, entry);
      }
      for (const val of opt.values) {
        if (entry.values.some((v) => v.id === val.id)) continue;
        entry.values.push({ key: urlKey(val.label), id: val.id, label: val.label, swatch: val.swatch });
      }
    }
  }

  /* Spec filters share the index — see SPEC_VALUE_PREFIX in ./types for why. */
  for (const [label, values] of cat.facetableSpecs) {
    byName.set(label, {
      key: urlKey(label),
      name: label,
      kind: 'select',
      source: 'spec',
      values: values.map((value) => ({
        key: urlKey(value),
        id: specValueId(label, value),
        label: value,
      })),
    });
  }

  return ok([...byName.values()]);
}

/* ---------------- collections ---------------- */

export async function getCollections(scope?: StoreScope): Promise<Collection[]> {
  const cat = await getCatalogue(scope);
  return ok(cat.collections);
}

export async function getCollectionBySlug(slug: string, scope?: StoreScope): Promise<Collection | null> {
  const cat = await getCatalogue(scope);
  return ok(cat.collectionBySlug.get(slug) ?? null);
}

/**
 * Collections with live counts and real member imagery attached.
 *
 * Empty collections are dropped rather than shown as "0 products" — a
 * navigation tile that leads to nothing is worse than one fewer tile. That
 * also means a curated list whose ids stop resolving disappears instead of
 * rendering a broken page.
 */
export async function getCollectionSummaries(
  opts: { store?: StoreScope; featuredOnly?: boolean; limit?: number } = {},
): Promise<CollectionSummary[]> {
  const cat = await getCatalogue(opts.store);
  const source = opts.featuredOnly ? cat.collections.filter((c) => c.featured) : cat.collections;

  const summaries = await Promise.all(
    source.map(async (collection) => {
      const { items, total } = await listProducts({
        ...collectionQuery(collection),
        store: opts.store,
        sort: collection.sort,
        perPage: 3,
      });
      return {
        ...collection,
        productCount: total,
        previewImages: items.map((p) => p.images[0]?.url).filter((u): u is string => Boolean(u)),
      };
    }),
  );

  const live = summaries.filter((c) => c.productCount > 0);
  return ok(opts.limit ? live.slice(0, opts.limit) : live);
}

/* ---------------- homepage ---------------- */

/**
 * The homepage's merchandised bands, every one derived from what the
 * merchant actually published: the tags they set, the categories they
 * featured, the sales their invoices record. Nothing here invents social
 * proof — a store with no reviews, press or Instagram shows none.
 */
export async function getHomepageSections(scope?: StoreScope): Promise<HomepageSections> {
  const cat = await getCatalogue(scope);
  const products = cat.products;
  const byTag = (t: ProductTag) => products.filter((p) => p.tags.includes(t));
  const newest = [...products].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  /* Only a product the merchant tagged "Deal of the day" gets the countdown:
   * inventing urgency for whatever happens to be discounted would be a claim
   * they never made. It runs to the end of today, which is what the band says. */
  const deal = byTag('deal-of-day')[0] ?? null;
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  return ok({
    hero: [],
    serviceFeatures: await serviceFeatures(cat.organizationSlug, cat.returnWindowDays),
    featuredCategories: cat.categories.filter((c) => c.featured && c.level === 0),
    dealOfTheDay: deal ? { product: deal, endsAt: endOfDay.toISOString() } : null,
    collections: [
      { key: 'new', title: 'New arrivals', subtitle: 'Fresh in this week', products: newest.slice(0, 8) },
      { key: 'bestsellers', title: 'Best sellers', subtitle: 'What everyone’s buying', products: byTag('bestseller').slice(0, 8) },
      { key: 'sale', title: 'On sale', subtitle: 'Limited-time prices', products: byTag('sale').slice(0, 8) },
      { key: 'trending', title: 'Trending now', subtitle: 'Picking up pace', products: byTag('trending').slice(0, 8) },
    ].filter((c) => c.products.length > 0),
    // Best-selling product from each root category, then the next best sellers
    // overall — a genuine spread rather than eight variations of one aisle.
    // Deterministic, so SSR and the client agree.
    recommended: (() => {
      const bySold = [...products].sort((a, b) => b.soldCount - a.soldCount || a.id.localeCompare(b.id));
      const seenRoot = new Set<string>();
      const picked: Product[] = [];
      for (const p of bySold) {
        const root = p.categoryIds[0];
        if (seenRoot.has(root)) continue;
        seenRoot.add(root);
        picked.push(p);
      }
      for (const p of bySold) {
        if (picked.length >= 10) break;
        if (!picked.includes(p)) picked.push(p);
      }
      return picked.slice(0, 10);
    })(),
    promoBanners: [],
    brands: cat.brands,
    testimonials: [],
    instagram: [],
    blog: [],
  });
}

/**
 * The promises shown at the foot of the homepage. Each restates something
 * the app genuinely does — the gateway it charges through, the delivery
 * options the cart offers, the returns window the policy sets — so the band
 * can't drift into claims a merchant never made.
 */
async function serviceFeatures(
  organizationSlug: string,
  returnWindowDays: number | null,
): Promise<HomepageSections['serviceFeatures']> {
  const options = await deliveryOverview(organizationSlug);
  const delivery = options.filter((o) => o.kind !== 'pickup');
  const nationwide = delivery.some((o) => o.label === 'Delivery across Nigeria');

  const features = [
    { icon: 'shield-check', title: 'Pay your way', description: 'Card or bank transfer through Squad, or pay on delivery' },
  ];
  if (delivery.length) {
    features.push({
      icon: 'truck',
      title: nationwide ? 'Delivery across Nigeria' : 'Delivery available',
      description: 'Options and prices for your address at checkout',
    });
  }
  if (returnWindowDays) {
    features.push({
      icon: 'rotate-ccw',
      title: 'Returns',
      description: `Ask to return items within ${returnWindowDays} days of delivery`,
    });
  }
  if (options.some((o) => o.kind === 'pickup')) {
    features.push({ icon: 'badge-check', title: 'Collect in store', description: 'Pick up your order instead' });
  }
  return features;
}

/* ---------------- store pages ----------------
 *
 * About, Delivery and returns, Terms, Privacy, FAQ, Size guide, Contact and
 * anything else — written by the merchant in Settings → Store pages, and
 * only ever what they published.
 *
 * There used to be a `getContentPage` here serving template copy from a
 * fixture that made promises this app doesn't keep (free delivery over
 * ₦50,000, free returns with a prepaid label). Nothing is generated now: a
 * store with no pages shows no links to any, and every link to a page is
 * built from this list, so a link can't point at a page that isn't there.
 */

/* ---------------- the shop's own look ---------------- */

/**
 * The merchant's hero slides, colours and listing details.
 *
 * Empty everywhere they have filled nothing in, which is what keeps a shop
 * that hasn't touched any of this looking exactly as it did.
 */
export async function getStorefrontLook(scope?: StoreScope): Promise<StorefrontLook> {
  return loadStorefrontLook(await resolveStoreSlug(scope));
}

/* ---------------- campaign announcements ---------------- */

/**
 * What a live campaign is telling shoppers, in the merchant's own words.
 *
 * Empty unless a merchant both turned an announcement on AND wrote
 * something — see lib/marketing/announcement.ts.
 */
export async function getCampaignAnnouncements(scope?: StoreScope): Promise<Announcement[]> {
  /* A demo catalogue has no campaigns behind it, and inventing one would put
   * words in a merchant's mouth on a page meant to look like theirs — the
   * lookup simply finds nothing, which is the right answer. */
  return loadLiveAnnouncements(await resolveStoreSlug(scope));
}

/** Links to the store's published pages — for footers, checkout, the cookie notice. */
export async function getStorePages(scope?: StoreScope): Promise<StorePageLink[]> {
  return loadStorePageLinks(await resolveStoreSlug(scope));
}

/** One published page by its web address, or null. */
export async function getStorePage(slug: string, scope?: StoreScope): Promise<PublishedStorePage | null> {
  if (!isValidPageSlug(slug)) return null;
  return loadStorePage(await resolveStoreSlug(scope), slug);
}

