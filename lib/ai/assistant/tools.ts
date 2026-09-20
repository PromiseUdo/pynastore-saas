/*
 * The shopping tool layer.
 *
 *   provider  →  ShoppingTools  →  Product Discovery / Detail services
 *                                →  lib/storefront/catalog.ts
 *                                →  fixtures today, Prisma/API later
 *
 * This is the ONLY surface a provider gets. It exists for three reasons:
 *
 *  1. No duplicate search. `searchProducts` is `listProducts` with a
 *     narrower argument list; cheaper/premium/similar are the very sets the
 *     product page already builds in lib/storefront/product-detail.ts. There
 *     is no second matcher here to drift from the one shoppers see.
 *  2. Tenant isolation by construction. Tools are made from a StoreScope and
 *     pass it into every catalogue read, so a provider cannot address another
 *     store's rows even by mistake — it never names a store at all.
 *  3. A shape real function calling can use. Each method takes ONE plain
 *     JSON-ish argument object, mirrored by TOOL_DEFINITIONS below, so the
 *     day an LLM is wired up the tool schema is a translation of this file
 *     rather than a redesign of it.
 *
 * Server-only: it reads the catalogue.
 */
import {
  getBrands as getBrandsFromCatalogue,
  getCategoryById,
  getCategoryTree,
  getDeliveryPromise,
  getOptionIndex,
  getProductById,
  getProductBySlug,
  getReviews,
  listProducts,
} from '@/lib/storefront/catalog';
import { getRecommendations } from '@/lib/storefront/product-detail';
import { getStoreCurrency } from '@/lib/storefront/discovery';
import type {
  Product,
  ProductOption,
  Review,
  ReviewSummary,
  SortKey,
  StoreScope,
} from '@/lib/storefront/types';

/* ───────────────────────────── arguments ─────────────────────────────── */

export interface SearchProductsArgs {
  query?: string;
  categoryPath?: string[];
  brandSlugs?: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly?: boolean;
  /** option-value ids from the store's own option index (colour, size…) */
  optionValueIds?: string[];
  sort?: SortKey;
  limit?: number;
}

export interface ProductRefArgs {
  productId?: string;
  slug?: string;
}

export interface OptionValueQuery {
  /** "size", "colour"… optional: "in black" names no option */
  option?: string;
  value: string;
}

export interface MatchedOptionValue {
  id: string;
  option: string;
  label: string;
}

export interface AlternativesArgs {
  productId: string;
  limit?: number;
}

/* ───────────────────────────── results ───────────────────────────────── */

export interface SearchProductsResult {
  items: Product[];
  total: number;
  /** lowest `priceFrom` across the WHOLE match set, not just this page —
   *  what an honest "the cheapest one here is …" has to be built from */
  lowestPrice: number | null;
  currency: string;
}

export interface ProductReviewsResult {
  summary: ReviewSummary;
  items: Review[];
}

export interface ProductSpecificationsResult {
  productId: string;
  specs: { label: string; value: string }[];
  highlights: string[];
  options: ProductOption[];
  /** option values that are genuinely buyable right now, by option name */
  availableOptionValues: Record<string, string[]>;
  inStock: boolean;
}

/**
 * The department a product sits in, with the price spread of that
 * department. The midpoint is what lets "is this worth it?" be answered with
 * a real comparison ("below the ₦85,000 midpoint for Sneakers") instead of
 * an opinion.
 */
export interface ProductCategoryResult {
  name: string;
  path: string[];
  productCount: number;
  /** median `priceFrom` across the whole department, in minor units */
  medianPrice: number | null;
}

/**
 * What this store is prepared to promise.
 *
 * Read from the same delivery/returns data the product page and the cart use,
 * so the assistant cannot quote a window checkout contradicts. `null` fields
 * mean "not configured" and must be answered as "I don't have that yet"
 * rather than filled in (§32).
 */
export interface StorePoliciesResult {
  returnWindowDays: number | null;
  pickupAvailable: boolean | null;
  delivery: { label: string; detail: string; price: number; free: boolean }[];
  currency: string;
}

/* ─────────────────────────── the tool surface ────────────────────────── */

export interface ShoppingTools {
  readonly store: StoreScope;
  searchProducts(args: SearchProductsArgs): Promise<SearchProductsResult>;
  getProduct(args: ProductRefArgs): Promise<Product | null>;
  getProducts(ids: string[]): Promise<Product[]>;
  findSimilarProducts(args: AlternativesArgs): Promise<Product[]>;
  findCheaperAlternatives(args: AlternativesArgs): Promise<Product[]>;
  findPremiumAlternatives(args: AlternativesArgs): Promise<Product[]>;
  getCategories(): Promise<{ name: string; path: string[]; productCount: number }[]>;
  getBrands(): Promise<{ name: string; slug: string }[]>;
  findOptionValues(args: { values: OptionValueQuery[] }): Promise<MatchedOptionValue[]>;
  getProductReviews(args: AlternativesArgs): Promise<ProductReviewsResult | null>;
  getProductSpecifications(args: AlternativesArgs): Promise<ProductSpecificationsResult | null>;
  getProductCategory(args: AlternativesArgs): Promise<ProductCategoryResult | null>;
  getStorePolicies(): Promise<StorePoliciesResult>;
  getCurrency(): Promise<string>;
}

const DEFAULT_LIMIT = 6;

/** Product ids can arrive from the client (the cart, the last answer). They
 *  are only ever used to LOOK UP rows through the tenant-scoped catalogue —
 *  an id from another store simply resolves to nothing. */
export function createShoppingTools(store: StoreScope): ShoppingTools {
  /*
   * The recommendation sets are all cut from one pass of
   * getRecommendations(), which is the function the product page itself
   * calls. Memoised per product for the lifetime of a request so three
   * follow-up questions about one product don't recompute it three times.
   */
  const recommendations = new Map<string, ReturnType<typeof getRecommendations>>();
  const recommendFor = (product: Product) => {
    let pending = recommendations.get(product.id);
    if (!pending) {
      pending = getRecommendations(product, store);
      recommendations.set(product.id, pending);
    }
    return pending;
  };

  /* Every single-row read names the store too. On /api there is no tenant
   * header to fall back on, so an unscoped read would throw — and scoping it
   * is what makes a foreign id resolve to nothing rather than to a row. */
  const resolve = async (args: AlternativesArgs) => getProductById(args.productId, store);

  return {
    store,

    async searchProducts(args) {
      const limit = Math.min(args.limit ?? DEFAULT_LIMIT, 24);
      const { items, total } = await listProducts({
        store,
        query: args.query,
        categoryPath: args.categoryPath,
        brandSlugs: args.brandSlugs,
        minPrice: args.minPrice,
        maxPrice: args.maxPrice,
        minRating: args.minRating,
        inStockOnly: args.inStockOnly,
        optionValueIds: args.optionValueIds,
        sort: args.sort,
        perPage: limit,
      });

      /* One extra read, ordered by price, so "the cheapest match is X" is a
       * fact about the whole result set rather than about the first page. */
      let lowestPrice: number | null = null;
      if (total > 0) {
        const cheapest = await listProducts({
          store,
          query: args.query,
          categoryPath: args.categoryPath,
          brandSlugs: args.brandSlugs,
          minPrice: args.minPrice,
          maxPrice: args.maxPrice,
          minRating: args.minRating,
          inStockOnly: args.inStockOnly,
          optionValueIds: args.optionValueIds,
          sort: 'price-asc',
          perPage: 1,
        });
        lowestPrice = cheapest.items[0]?.priceFrom ?? null;
      }

      return {
        items,
        total,
        lowestPrice,
        currency: items[0]?.currency ?? (await getStoreCurrency(store)),
      };
    },

    async getProduct({ productId, slug }) {
      if (productId) return getProductById(productId, store);
      if (slug) return getProductBySlug(slug, store);
      return null;
    },

    async getProducts(ids) {
      if (!ids.length) return [];
      const { items } = await listProducts({ store, productIds: ids, perPage: ids.length });
      const byId = new Map(items.map((p) => [p.id, p]));
      return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
    },

    async findSimilarProducts(args) {
      const product = await resolve(args);
      if (!product) return [];
      const { similar } = await recommendFor(product);
      return similar.slice(0, args.limit ?? DEFAULT_LIMIT);
    },

    async findCheaperAlternatives(args) {
      const product = await resolve(args);
      if (!product) return [];
      // Relevance-first and strictly below this product's price — the rail
      // the PDP shows, not "the cheapest things in the store" (§20).
      const { cheaper } = await recommendFor(product);
      return cheaper.slice(0, args.limit ?? DEFAULT_LIMIT);
    },

    async findPremiumAlternatives(args) {
      const product = await resolve(args);
      if (!product) return [];
      // Costs more AND is better rated or better selling — never "expensive
      // therefore better" (§21).
      const { premium } = await recommendFor(product);
      return premium.slice(0, args.limit ?? DEFAULT_LIMIT);
    },

    async getCategories() {
      const tree = await getCategoryTree(store);
      const out: { name: string; path: string[]; productCount: number }[] = [];
      const walk = (nodes: Awaited<ReturnType<typeof getCategoryTree>>) => {
        for (const node of nodes) {
          if (node.productCount > 0) {
            out.push({ name: node.name, path: node.path, productCount: node.productCount });
          }
          walk(node.children);
        }
      };
      walk(tree);
      return out;
    },

    async getBrands() {
      const brands = await getBrandsFromCatalogue(store);
      return brands.map((b) => ({ name: b.name, slug: b.slug }));
    },

    /* "In size 42", "in black" → the store's own option-value ids, matched
     * by label. A value the store doesn't carry matches nothing, so a filter
     * can never be built from a word the catalogue hasn't got. */
    async findOptionValues({ values }) {
      if (!values.length) return [];
      const index = await getOptionIndex(store);
      const out: MatchedOptionValue[] = [];
      for (const wanted of values.slice(0, 4)) {
        const value = normaliseLabel(wanted.value);
        const option = wanted.option ? normaliseLabel(wanted.option) : '';
        if (!value) continue;
        for (const entry of index) {
          if (option && !optionNameMatches(entry.name, entry.kind, option)) continue;
          /* Exact label first; otherwise a whole word of it, so "42" finds
           * "EU 42" and "black" finds "Jet Black" — but "4" never finds "4XL". */
          const exact = entry.values.filter((v) => normaliseLabel(v.label) === value);
          const hits = exact.length
            ? exact
            : entry.values.filter((v) => labelTokens(v.label).includes(value));
          for (const hit of hits) out.push({ id: hit.id, option: entry.name, label: hit.label });
        }
      }
      return out;
    },

    async getProductReviews(args) {
      const product = await resolve(args);
      if (!product) return null;
      const { items } = await getReviews(
        product.id,
        { sort: 'helpful', perPage: args.limit ?? 3 },
        store,
      );
      return { summary: product.rating, items };
    },

    async getProductSpecifications(args) {
      const product = await resolve(args);
      if (!product) return null;

      /* Which option values a shopper could actually buy today. Derived from
       * variant stock rather than from the option list, so "do you have it in
       * blue?" is answered by inventory and not by the swatch row. */
      const inStockValueIds = new Set(
        product.variants.filter((v) => v.stock > 0).flatMap((v) => v.optionValueIds),
      );
      const availableOptionValues: Record<string, string[]> = {};
      for (const option of product.options) {
        availableOptionValues[option.name] = option.values
          .filter((value) => inStockValueIds.has(value.id))
          .map((value) => value.label);
      }

      return {
        productId: product.id,
        specs: product.specs,
        highlights: product.highlights,
        options: product.options,
        availableOptionValues,
        inStock: product.inStock,
      };
    },

    async getProductCategory(args) {
      const product = await resolve(args);
      if (!product) return null;
      const category = await getCategoryById(product.categoryId, store);
      if (!category) return null;

      /* The whole department, ordered by price, so the midpoint is a real
       * median and not the middle of the first page. */
      const { items, total } = await listProducts({
        store,
        categoryPath: category.path,
        sort: 'price-asc',
        perPage: 500,
      });

      return {
        name: category.name,
        path: category.path,
        productCount: total,
        medianPrice: items.length ? items[Math.floor(items.length / 2)].priceFrom : null,
      };
    },

    async getStorePolicies() {
      const promise = await getDeliveryPromise(store);
      return {
        returnWindowDays: promise.returnWindowDays ?? null,
        pickupAvailable: promise.pickupAvailable ?? null,
        delivery: promise.options.map((o) => ({
          label: o.label,
          detail: o.detail,
          price: o.price,
          free: o.free,
        })),
        currency: promise.currency,
      };
    },

    getCurrency: () => getStoreCurrency(store),
  };
}

function normaliseLabel(s: string): string {
  return s.toLowerCase().replace(/colour/g, 'color').replace(/[^a-z0-9.]+/g, '');
}

function labelTokens(label: string): string[] {
  return label.toLowerCase().replace(/colour/g, 'color').split(/[^a-z0-9.]+/).filter(Boolean);
}

function optionNameMatches(name: string, kind: string, wanted: string): boolean {
  const n = normaliseLabel(name);
  return n.includes(wanted) || wanted.includes(n) || normaliseLabel(kind) === wanted;
}

/* ───────────────────── future LLM function definitions ───────────────── */

/**
 * The same tools, described the way a model needs them (§35).
 *
 * Not exposed as public HTTP endpoints — they stay internal service calls.
 * Kept beside the implementation so the two cannot drift: if a method here
 * gains an argument, this is the file the change is already open in.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'search_products',
    description:
      "Search this store's catalogue. Returns real product rows. Use for any request to find, browse or filter products.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'free-text keywords' },
        categoryPath: { type: 'array', items: { type: 'string' }, description: 'category slug path' },
        brandSlugs: { type: 'array', items: { type: 'string' } },
        minPrice: { type: 'integer', description: 'minor units (kobo/cents)' },
        maxPrice: { type: 'integer', description: 'minor units (kobo/cents)' },
        minRating: { type: 'number' },
        inStockOnly: { type: 'boolean' },
        sort: {
          type: 'string',
          enum: ['relevance', 'newest', 'price-asc', 'price-desc', 'rating', 'bestselling'],
        },
        limit: { type: 'integer', maximum: 24 },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Fetch one product row by id or slug.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' }, slug: { type: 'string' } },
    },
  },
  {
    name: 'find_similar_products',
    description: 'Products closest to this one — same part of the catalogue, comparable price.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' }, limit: { type: 'integer' } },
      required: ['productId'],
    },
  },
  {
    name: 'find_cheaper_alternatives',
    description:
      'Related products that cost meaningfully less than this one. Not simply the cheapest products in the store.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' }, limit: { type: 'integer' } },
      required: ['productId'],
    },
  },
  {
    name: 'find_premium_alternatives',
    description:
      'Related products that cost more AND are rated higher or sell harder. Never justify these as "better" without those figures.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' }, limit: { type: 'integer' } },
      required: ['productId'],
    },
  },
  {
    name: 'find_option_values',
    description:
      "Match option values the shopper named (a size, a colour) to this store's own option values. Unmatched values are not carried.",
    parameters: {
      type: 'object',
      properties: {
        values: {
          type: 'array',
          items: {
            type: 'object',
            properties: { option: { type: 'string' }, value: { type: 'string' } },
            required: ['value'],
          },
        },
      },
      required: ['values'],
    },
  },
  {
    name: 'get_product_reviews',
    description: 'Rating summary and the most helpful reviews for a product.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' }, limit: { type: 'integer' } },
      required: ['productId'],
    },
  },
  {
    name: 'get_product_specifications',
    description:
      'Listed specifications, highlights, options and which option values are in stock. If a fact is not here, it is not known — say so.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
    },
  },
  {
    name: 'get_product_category',
    description:
      "The department a product belongs to, with that department's product count and median price.",
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
    },
  },
  {
    name: 'get_categories',
    description: 'Departments in this store that have stock behind them.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_brands',
    description: 'Brands this store carries.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_store_policies',
    description:
      "This store's delivery options, return window and pickup availability. Fields that are null are not configured — do not answer them.",
    parameters: { type: 'object', properties: {} },
  },
] as const;
