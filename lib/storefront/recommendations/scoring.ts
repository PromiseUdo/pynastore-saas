/*
 * Recommendation scoring — every weight in one place.
 *
 * Pure functions over Product rows. No catalogue reads, no randomness, no
 * clock: the same inputs always produce the same number, which is what makes
 * a ranking testable and a bad recommendation debuggable.
 *
 * This is the file a real ranking model replaces. Nothing outside the
 * recommendation layer (and the PDP rails in product-detail.ts, which share
 * `similarityScore` so the two can never disagree about "similar") reads a
 * weight.
 *
 * Scale, roughly: a shared category level is worth 100, so category
 * structure dominates; brand/colour/tags adjust within a category; price,
 * popularity and newness are 0..1 terms scaled small enough to break ties
 * rather than override relevance.
 */
import type { Money, Product } from '@/lib/storefront/types';

export const WEIGHTS = {
  /* similarity — anchor product vs candidate */
  sharedCategoryLevel: 100,
  sameBrand: 25,
  sharedTag: 10,
  sharedColour: 4,
  sharedSpecValue: 3,
  priceProximity: 5,

  /* affinity — session profile vs candidate */
  categoryAffinity: 60,
  brandAffinity: 20,
  colourAffinity: 6,
  priceAffinity: 15,

  /* context-free quality */
  popularity: 12,
  rating: 6,
  newness: 4,

  /* complements — the merchant's "goes well with" categories */
  complementCategory: 80,
  /** a product that shares real baskets with a bag item — the strongest
   *  complement signal there is, so it outranks a category pairing */
  boughtTogether: 110,
  /** per extra shared basket, capped — see rules-provider forCart */
  boughtTogetherPerBasket: 5,
  complementsMoreThanOne: 20,
  /** a saved item's companions, mixed into the homepage beside similar items */
  wishlistComplement: 45,

  /* penalties */
  alreadyViewed: -40,
  outOfStock: -1000,
} as const;

/** How much each kind of signal counts towards the affinity profile. */
export const SIGNAL_WEIGHTS = {
  viewed: 1,
  wishlist: 1.5,
  cart: 2,
  /** a category reached through a query or a category page, not a product */
  browsedCategory: 0.75,
  /** each step back in the recently-viewed list keeps this share */
  recencyDecay: 0.85,
} as const;

/** Products created within this many days get a newness bonus. */
const NEW_WINDOW_DAYS = 120;

/* ───────────────────────────── similarity ────────────────────────────── */

function colourIds(product: Product): string[] {
  return product.options.filter((o) => o.kind === 'color').flatMap((o) => o.values.map((v) => v.id));
}

function specKeys(product: Product): string[] {
  return product.specs.map((s) => `${s.label}:${s.value}`);
}

/** 1 when prices are equal, falling towards 0 as they diverge. */
export function priceProximity(reference: Money, candidate: Money): number {
  const spread = Math.abs(candidate - reference);
  return 1 / (1 + spread / Math.max(reference, 1));
}

/**
 * How alike two products are. The deepest shared category dominates, then a
 * shared brand, tags, colourways and attribute values; price only breaks
 * ties.
 */
export function similarityScore(anchor: Product, candidate: Product): number {
  const sharedLevels = candidate.categoryIds.filter((id) => anchor.categoryIds.includes(id)).length;
  const sameBrand = candidate.brandId === anchor.brandId ? 1 : 0;
  const sharedTags = candidate.tags.filter((t) => anchor.tags.includes(t)).length;

  const anchorColours = new Set(colourIds(anchor));
  const sharedColours = colourIds(candidate).filter((id) => anchorColours.has(id)).length;

  const anchorSpecs = new Set(specKeys(anchor));
  const sharedSpecs = specKeys(candidate).filter((k) => anchorSpecs.has(k)).length;

  return (
    sharedLevels * WEIGHTS.sharedCategoryLevel +
    sameBrand * WEIGHTS.sameBrand +
    sharedTags * WEIGHTS.sharedTag +
    Math.min(sharedColours, 3) * WEIGHTS.sharedColour +
    sharedSpecs * WEIGHTS.sharedSpecValue +
    priceProximity(anchor.priceFrom, candidate.priceFrom) * WEIGHTS.priceProximity
  );
}

/* ────────────────────────────── affinity ─────────────────────────────── */

/**
 * What a session's signals add up to. Built fresh per request from ids the
 * catalogue resolved — never stored, never sent back to the client.
 */
export interface AffinityProfile {
  /** category id → accumulated weight (leaf and ancestors) */
  categories: Map<string, number>;
  brands: Map<string, number>;
  colours: Map<string, number>;
  /** weighted geometric-mean price of signal products, or null */
  priceCentre: Money | null;
  /** product ids the shopper has already looked at */
  viewedIds: Set<string>;
  /** total signal weight — 0 means cold start */
  strength: number;
}

export interface WeightedSignal {
  product: Product;
  weight: number;
}

/** Leaf categories count fully, each ancestor level up counts half as much. */
function addCategoryWeight(map: Map<string, number>, categoryIds: string[], weight: number) {
  const leafFirst = [...categoryIds].reverse();
  leafFirst.forEach((id, depth) => {
    map.set(id, (map.get(id) ?? 0) + weight / 2 ** depth);
  });
}

export function buildAffinityProfile(
  signals: WeightedSignal[],
  opts: { viewedIds?: string[]; browsedCategoryIds?: string[][] } = {},
): AffinityProfile {
  const categories = new Map<string, number>();
  const brands = new Map<string, number>();
  const colours = new Map<string, number>();
  let logPriceSum = 0;
  let priceWeight = 0;
  let strength = 0;

  for (const { product, weight } of signals) {
    if (weight <= 0) continue;
    strength += weight;
    addCategoryWeight(categories, product.categoryIds, weight);
    brands.set(product.brandId, (brands.get(product.brandId) ?? 0) + weight);
    for (const id of colourIds(product)) colours.set(id, (colours.get(id) ?? 0) + weight / 3);
    logPriceSum += Math.log(Math.max(product.priceFrom, 1)) * weight;
    priceWeight += weight;
  }

  for (const categoryIds of opts.browsedCategoryIds ?? []) {
    strength += SIGNAL_WEIGHTS.browsedCategory;
    addCategoryWeight(categories, categoryIds, SIGNAL_WEIGHTS.browsedCategory);
  }

  return {
    categories,
    brands,
    colours,
    priceCentre: priceWeight > 0 ? Math.round(Math.exp(logPriceSum / priceWeight)) : null,
    viewedIds: new Set(opts.viewedIds ?? []),
    strength,
  };
}

/** Normalised 0..1 share of the strongest entry in a weight map. */
function share(map: Map<string, number>, key: string): number {
  const value = map.get(key);
  if (!value) return 0;
  return value / Math.max(...map.values());
}

/** How well a candidate fits a session profile. 0 for a cold profile. */
export function affinityScore(profile: AffinityProfile, candidate: Product): number {
  if (profile.strength === 0) return 0;

  // The best-matching category on the candidate's path, not the sum — a
  // product shouldn't outrank a closer match just for having a deeper tree.
  const categoryFit = Math.max(0, ...candidate.categoryIds.map((id) => share(profile.categories, id)));
  const brandFit = share(profile.brands, candidate.brandId);
  const colourFit = Math.max(0, ...colourIds(candidate).map((id) => share(profile.colours, id)));
  const priceFit =
    profile.priceCentre === null ? 0 : logPriceProximity(profile.priceCentre, candidate.priceFrom);

  return (
    categoryFit * WEIGHTS.categoryAffinity +
    brandFit * WEIGHTS.brandAffinity +
    colourFit * WEIGHTS.colourAffinity +
    priceFit * WEIGHTS.priceAffinity +
    (profile.viewedIds.has(candidate.id) ? WEIGHTS.alreadyViewed : 0)
  );
}

/**
 * Price closeness on a log scale: ₦10k vs ₦20k is as far apart as ₦500k vs
 * ₦1m. A linear spread would call every accessory "nowhere near" a laptop.
 */
export function logPriceProximity(centre: Money, candidate: Money): number {
  const distance = Math.abs(Math.log(Math.max(candidate, 1)) - Math.log(Math.max(centre, 1)));
  return 1 / (1 + distance * 2);
}

/* ─────────────────────────── context-free quality ────────────────────── */

/** What a candidate's quality is measured against — taken from its pool. */
export interface QualityReference {
  maxSold: number;
  /** epoch ms of the newest product in the pool */
  newestAt: number;
}

export function qualityReference(pool: Product[]): QualityReference {
  return {
    maxSold: Math.max(0, ...pool.map((p) => p.soldCount)),
    newestAt: Math.max(0, ...pool.map((p) => +new Date(p.createdAt))),
  };
}

/**
 * Popularity, rating and newness as one small bonus. Sales are log-scaled
 * so a runaway bestseller can't flatten every other signal.
 *
 * Newness is measured against the newest product in the same pool, never
 * against the clock: two identical requests a second apart must score
 * identically (§9).
 */
export function qualityScore(candidate: Product, reference: QualityReference): number {
  const { maxSold, newestAt } = reference;
  const popularity = maxSold > 0 ? Math.log1p(candidate.soldCount) / Math.log1p(maxSold) : 0;
  // Ratings need volume before they mean anything.
  const confidence = Math.min(candidate.rating.count / 50, 1);
  const rating = (candidate.rating.average / 5) * confidence;
  const ageDays = Math.max(0, (newestAt - +new Date(candidate.createdAt)) / 86_400_000);
  const newness = ageDays <= NEW_WINDOW_DAYS ? 1 - ageDays / NEW_WINDOW_DAYS : 0;

  return (
    popularity * WEIGHTS.popularity +
    rating * WEIGHTS.rating +
    newness * WEIGHTS.newness +
    (candidate.inStock ? 0 : WEIGHTS.outOfStock)
  );
}

/** Deterministic comparator: score desc, then id — never input order. */
export function byScoreThenId<T extends { score: number; productId: string }>(a: T, b: T): number {
  return b.score - a.score || a.productId.localeCompare(b.productId);
}
