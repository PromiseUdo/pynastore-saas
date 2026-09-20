/*
 * lib/storefront/data/catalogue.ts
 *
 * One tenant's storefront catalogue, already mapped into the shapes in
 * ../types.ts, plus the lookup indexes the query engine in ../catalog.ts
 * needs. Built either from the merchant's real records (./from-prisma.ts)
 * or from the demo fixtures (./from-fixtures.ts) — the engine can't tell
 * them apart, which is what keeps the fixtures useful for tests.
 */
import type { Brand, Category, Collection, Product, Review } from '../types';
import { urlKey } from '../product-helpers';
import { RESERVED_URL_KEYS } from '../discovery-url';
import type { BoughtTogether } from './bought-together';

/**
 * A category's "goes well with" rule, as the merchant set it: companion
 * category ids, best first, and the rail's heading (null = the default).
 */
export interface CompanionRule {
  title: string | null;
  categoryIds: string[];
}

export interface Catalogue {
  organizationSlug: string;
  storeName: string;
  currency: string;
  /** days after delivery a shopper may ask to return items; null = the store doesn't take returns */
  returnWindowDays: number | null;

  products: Product[];
  productById: Map<string, Product>;
  productBySlug: Map<string, Product>;

  categories: Category[];
  categoryById: Map<string, Category>;
  categoryBySlug: Map<string, Category>;
  /** a category id and every id beneath it */
  subtreeIds: (categoryId: string) => string[];

  brands: Brand[];
  brandById: Map<string, Brand>;
  brandBySlug: Map<string, Brand>;

  collections: Collection[];
  collectionBySlug: Map<string, Collection>;

  /** spec labels worth offering as filters → their values */
  facetableSpecs: Map<string, string[]>;
  /** false when nothing in this catalogue carries a rating, so the UI can drop the filter */
  hasRatings: boolean;

  /**
   * The published reviews of one product, unsorted.
   *
   * A function rather than a field: a store's reviews are read only by the
   * page that shows them, and loading every one of them alongside every
   * product would make a category page pay for a product page. ../catalog.ts
   * does the sorting and paging, so the fixtures and the database can't
   * order a page differently.
   */
  reviewsFor: (productId: string) => Promise<Review[]>;

  /**
   * The merchant's companion categories for a category, already narrowed to
   * categories this catalogue contains (and never the category itself).
   * null when the merchant hasn't set any.
   */
  companionsFor: (categoryId: string) => CompanionRule | null;

  /**
   * Products that share real baskets with this one, strongest first. Ids
   * only — ../catalog.ts resolves them, so an unpublished or delisted
   * product drops out. On demand, like reviews.
   */
  boughtTogether: (productId: string) => Promise<BoughtTogether[]>;
}

export interface CataloguePartsInput {
  organizationSlug: string;
  storeName: string;
  currency: string;
  /** defaults to null: no returns promised unless the merchant set a window */
  returnWindowDays?: number | null;
  products: Product[];
  categories: Category[];
  brands: Brand[];
  collections: Collection[];
  /** defaults to "this store has none", which is what an empty store has */
  reviewsFor?: (productId: string) => Promise<Review[]>;
  /** category id → its companion rule; categories without one are absent */
  companions?: Map<string, CompanionRule>;
  /** defaults to "no sales yet" */
  boughtTogether?: (productId: string) => Promise<BoughtTogether[]>;
}

/**
 * Spec labels worth offering as a filter, derived from the catalogue itself
 * rather than configured per department. A label qualifies when it has
 * between 2 and 8 distinct values: fewer narrows nothing, more means it is
 * free text (dimensions, weights) and not a facet. Keys that would collide
 * with a variant option or a reserved URL key are dropped, so one URL key
 * always means one thing.
 */
function facetableSpecsOf(products: Product[]): Map<string, string[]> {
  const values = new Map<string, Set<string>>();
  for (const p of products) {
    for (const spec of p.specs) {
      if (!values.has(spec.label)) values.set(spec.label, new Set());
      values.get(spec.label)!.add(spec.value);
    }
  }
  const optionKeys = new Set(products.flatMap((p) => p.options.map((o) => urlKey(o.name))));
  const out = new Map<string, string[]>();
  for (const [label, set] of values) {
    const key = urlKey(label);
    if (set.size < 2 || set.size > 8) continue;
    if (optionKeys.has(key) || RESERVED_URL_KEYS.has(key)) continue;
    out.set(label, [...set].sort());
  }
  return out;
}

export function buildCatalogue(parts: CataloguePartsInput): Catalogue {
  const { products, categories, brands, collections } = parts;

  const childrenOf = new Map<string | null, Category[]>();
  for (const c of categories) {
    const list = childrenOf.get(c.parentId) ?? [];
    list.push(c);
    childrenOf.set(c.parentId, list);
  }

  /* Rules are cleaned once, here, for both sources: only categories this
   * catalogue holds (a hidden, deleted or foreign id drops out), no self-pairing,
   * no repeats. A rule left with nothing is no rule. */
  const knownIds = new Set(categories.map((c) => c.id));
  const companionRules = new Map<string, CompanionRule>();
  for (const [categoryId, rule] of parts.companions ?? []) {
    if (!knownIds.has(categoryId)) continue;
    const ids = [...new Set(rule.categoryIds)].filter((id) => id !== categoryId && knownIds.has(id));
    if (ids.length) companionRules.set(categoryId, { title: rule.title?.trim() || null, categoryIds: ids });
  }
  const companionsLookup = (categoryId: string) => companionRules.get(categoryId) ?? null;

  const subtreeCache = new Map<string, string[]>();
  const subtreeIds = (categoryId: string): string[] => {
    const cached = subtreeCache.get(categoryId);
    if (cached) return cached;
    const ids: string[] = [];
    const stack = [categoryId];
    while (stack.length) {
      const id = stack.pop()!;
      ids.push(id);
      for (const child of childrenOf.get(id) ?? []) stack.push(child.id);
    }
    subtreeCache.set(categoryId, ids);
    return ids;
  };

  return {
    organizationSlug: parts.organizationSlug,
    storeName: parts.storeName,
    currency: parts.currency,
    returnWindowDays: parts.returnWindowDays ?? null,

    products,
    productById: new Map(products.map((p) => [p.id, p])),
    productBySlug: new Map(products.map((p) => [p.slug, p])),

    categories,
    categoryById: new Map(categories.map((c) => [c.id, c])),
    categoryBySlug: new Map(categories.map((c) => [c.slug, c])),
    subtreeIds,

    brands,
    brandById: new Map(brands.map((b) => [b.id, b])),
    brandBySlug: new Map(brands.map((b) => [b.slug, b])),

    collections,
    collectionBySlug: new Map(collections.map((c) => [c.slug, c])),

    facetableSpecs: facetableSpecsOf(products),
    hasRatings: products.some((p) => p.rating.count > 0),
    reviewsFor: parts.reviewsFor ?? (async () => []),
    companionsFor: (categoryId) => companionsLookup(categoryId),
    boughtTogether: parts.boughtTogether ?? (async () => []),
  };
}

/** A store with nothing published yet — every page renders its empty state. */
export function emptyCatalogue(organizationSlug: string, storeName = '', currency = 'NGN'): Catalogue {
  return buildCatalogue({ organizationSlug, storeName, currency, products: [], categories: [], brands: [], collections: [] });
}
