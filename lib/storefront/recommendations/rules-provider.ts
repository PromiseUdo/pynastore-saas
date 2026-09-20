/*
 * RulesRecommendationProvider — the storefront's recommendation engine.
 *
 * Deterministic and explainable rather than learned: every id comes from the
 * store's catalogue through the port; every reason names a signal that
 * genuinely produced the item. No randomness and no clock: the same store +
 * placement + context gives the same ranking every time. Its inputs are the
 * store's real data — products, sales counts, the merchant's own
 * "goes well with" pairings and what customers actually bought together.
 * No model and no paid service: a store's traffic costs catalogue reads.
 *
 * Per placement it answers one question:
 *
 *   product   "what else is like this?"            similarity to the anchor
 *   cart      "what goes with what's in the bag?"  co-purchases, then the
 *                                                  merchant's pairings
 *   search    "what's near what they searched?"    the query's departments
 *   category  "what's good in here?"               popularity in the subtree
 *   homepage  "what fits this shopper?"            session affinity
 *
 * …and in every placement, a warm session nudges the order towards the
 * shopper's categories, brands, colours and price range. A cold session
 * falls straight through to context, and — for the homepage — to nothing,
 * which is the service's cue to use its cold-start ladder.
 *
 * Replacing this with a real engine is one module implementing
 * RecommendationProvider and a line in ./service.ts.
 */
import {
  SIGNAL_WEIGHTS,
  WEIGHTS,
  affinityScore,
  buildAffinityProfile,
  byScoreThenId,
  qualityReference,
  qualityScore,
  similarityScore,
  type AffinityProfile,
  type WeightedSignal,
} from './scoring';
import type {
  NormalizedRecommendationRequest,
  RankedRecommendation,
  RecommendationCatalogue,
  RecommendationProvider,
  RecommendationReason,
  RecommendationStrategy,
} from './types';
import type { Product } from '@/lib/storefront/types';

/** How many candidates to consider per requested item. */
const POOL_FACTOR = 4;
/** Below this, a leaf category is too thin and the pool widens to its parent. */
const MIN_POOL = 12;
/** Personal affinity is a nudge on context placements, the driver on the homepage. */
const CONTEXT_AFFINITY_SHARE = 0.35;
/** How many of the shopper's strongest categories seed homepage candidates. */
const HOMEPAGE_CATEGORY_SEEDS = 4;

interface SessionState {
  profile: AffinityProfile;
  viewed: Product[];
  wishlist: Product[];
  cart: Product[];
}

export function createRulesRecommendationProvider(): RecommendationProvider {
  return {
    name: 'rules',

    async recommend(request, catalogue) {
      const session = await resolveSession(request, catalogue);

      switch (request.placement) {
        case 'product':
          return forProduct(request, catalogue, session);
        case 'cart':
          return forCart(request, catalogue, session);
        case 'search':
          return forSearch(request, catalogue, session);
        case 'category':
          return forCategory(request, catalogue, session);
        case 'homepage':
          return forHomepage(request, catalogue, session);
      }
    },
  };
}

/* ───────────────────────────── the session ───────────────────────────── */

/**
 * Turn signal ids into a profile. Every id is resolved through the scoped
 * catalogue first, so a foreign or forged id contributes nothing (§26).
 */
async function resolveSession(
  request: NormalizedRecommendationRequest,
  catalogue: RecommendationCatalogue,
): Promise<SessionState> {
  const { signals } = request.context;

  const [viewed, wishlist, cart] = await Promise.all([
    catalogue.productsByIds(signals.recentlyViewedIds),
    catalogue.productsByIds(signals.wishlistIds),
    catalogue.productsByIds(signals.cartIds),
  ]);

  const weighted: WeightedSignal[] = [
    ...viewed.map((product, i) => ({
      product,
      weight: SIGNAL_WEIGHTS.viewed * SIGNAL_WEIGHTS.recencyDecay ** i,
    })),
    ...wishlist.map((product) => ({ product, weight: SIGNAL_WEIGHTS.wishlist })),
    ...cart.map((product) => ({ product, weight: SIGNAL_WEIGHTS.cart })),
  ];

  // Browsed categories and searches shape affinity too — but only as the
  // departments this store actually has.
  const [browsed, searched] = await Promise.all([
    Promise.all(signals.recentCategoryPaths.map((path) => categoryIdsForPath(catalogue, path))),
    Promise.all(
      signals.recentQueries.map(async (query) => (await catalogue.search(query, 1))[0]?.categoryIds ?? []),
    ),
  ]);

  const profile = buildAffinityProfile(weighted, {
    viewedIds: viewed.map((p) => p.id),
    browsedCategoryIds: [...browsed, ...searched].filter((ids) => ids.length > 0),
  });

  return { profile, viewed, wishlist, cart };
}

/** Root → leaf category ids for a browsed path; empty if the store lacks it. */
async function categoryIdsForPath(catalogue: RecommendationCatalogue, path: string[]): Promise<string[]> {
  const leaf = await catalogue.categoryByPath(path);
  if (!leaf) return [];
  const ancestors = await Promise.all(
    path.slice(0, -1).map((_, i) => catalogue.categoryByPath(path.slice(0, i + 1))),
  );
  return [...ancestors.filter((c) => c !== null).map((c) => c.id), leaf.id];
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function blocked(request: NormalizedRecommendationRequest, session: SessionState): Set<string> {
  return new Set([
    ...request.exclude,
    ...(request.context.productId ? [request.context.productId] : []),
    ...session.cart.map((p) => p.id),
    /* On the homepage, viewed products already have their own rail
     * ("Continue exploring") and saved ones are already the shopper's —
     * neither is a discovery. Elsewhere viewed items are only scored down. */
    ...(request.placement === 'homepage'
      ? [...session.viewed, ...session.wishlist].map((p) => p.id)
      : []),
  ]);
}

function rank(
  candidates: Product[],
  request: NormalizedRecommendationRequest,
  session: SessionState,
  score: (candidate: Product) => number,
  explain: (candidate: Product) => { reason: RecommendationReason; strategy: RecommendationStrategy },
): RankedRecommendation[] {
  const skip = blocked(request, session);
  const seen = new Set<string>();
  const reference = qualityReference(candidates);

  const ranked: RankedRecommendation[] = [];
  for (const candidate of candidates) {
    if (skip.has(candidate.id) || seen.has(candidate.id) || !candidate.inStock) continue;
    seen.add(candidate.id);
    ranked.push({
      productId: candidate.id,
      score: score(candidate) + qualityScore(candidate, reference),
      ...explain(candidate),
    });
  }
  return ranked.sort(byScoreThenId).slice(0, request.limit);
}

/** Leaf first, widening up the tree only while the pool is too thin. */
async function categoryPool(
  anchor: Product,
  catalogue: RecommendationCatalogue,
  minimum: number,
): Promise<Product[]> {
  let pool: Product[] = [];
  for (const categoryId of [...anchor.categoryIds].reverse()) {
    const category = await catalogue.categoryById(categoryId);
    if (!category) continue;
    pool = (await catalogue.bestsellers({ categoryPath: category.path, limit: minimum * 2 })).filter(
      (p) => p.id !== anchor.id,
    );
    if (pool.length >= minimum) break;
  }
  return pool;
}

/** The strongest single signal behind a personal match, for an honest reason. */
function personalReason(session: SessionState, candidate: Product): RecommendationReason {
  const closest = (list: Product[]) =>
    Math.max(0, ...list.map((p) => (p.categoryId === candidate.categoryId ? 2 : sharesParent(p, candidate) ? 1 : 0)));

  const cart = closest(session.cart);
  const wishlist = closest(session.wishlist);
  const viewed = closest(session.viewed);

  if (cart && cart >= wishlist && cart >= viewed) {
    return { kind: 'cart-similar', label: 'Similar to items in your bag' };
  }
  if (wishlist && wishlist >= viewed) {
    return { kind: 'wishlist-similar', label: 'Similar to items you saved' };
  }
  if (viewed) return { kind: 'viewed-similar', label: 'Because you viewed similar items' };
  // Matched on brand/colour/price or a browsed department rather than a product.
  return { kind: 'browsing-affinity', label: 'Based on what you’re browsing' };
}

function sharesParent(a: Product, b: Product): boolean {
  const parent = (p: Product) => p.categoryIds[p.categoryIds.length - 2];
  return parent(a) !== undefined && parent(a) === parent(b);
}

/* ─────────────────────────────── placements ──────────────────────────── */

async function forProduct(
  request: NormalizedRecommendationRequest,
  catalogue: RecommendationCatalogue,
  session: SessionState,
): Promise<RankedRecommendation[]> {
  const productId = request.context.productId;
  const [anchor] = productId ? await catalogue.productsByIds([productId]) : [];
  // An unknown or foreign product id is no context at all.
  if (!anchor) return forHomepage(request, catalogue, session);

  const pool = await categoryPool(anchor, catalogue, Math.max(MIN_POOL, request.limit * 2));

  return rank(
    pool,
    request,
    session,
    (c) => similarityScore(anchor, c) + affinityScore(session.profile, c) * CONTEXT_AFFINITY_SHARE,
    () => ({ reason: { kind: 'similar-to-product', label: 'Similar to this product' }, strategy: 'contextual' }),
  );
}

async function forCart(
  request: NormalizedRecommendationRequest,
  catalogue: RecommendationCatalogue,
  session: SessionState,
): Promise<RankedRecommendation[]> {
  if (!session.cart.length) return forHomepage(request, catalogue, session);

  /*
   * Two sources, strongest first:
   *  1. what customers of this store bought alongside the bag's items — real
   *     shared baskets, counted across the whole bag;
   *  2. the merchant's "goes well with" categories, counted too — a category
   *     that complements two things in the bag beats one that complements one.
   * A category the bag already covers is not a complement.
   */
  const inBag = new Set(session.cart.map((p) => p.categoryId));

  const basketsWith = new Map<string, number>();
  const pairs = await Promise.all(session.cart.map((item) => catalogue.boughtTogether(item.id, 12)));
  for (const { productId, baskets } of pairs.flat()) {
    basketsWith.set(productId, (basketsWith.get(productId) ?? 0) + baskets);
  }
  const coPurchased = basketsWith.size ? await catalogue.productsByIds([...basketsWith.keys()]) : [];

  const companionCounts = new Map<string, number>();
  const companionPaths = new Map<string, string[]>();
  const rules = await Promise.all(session.cart.map((item) => catalogue.companions(item.categoryId)));
  for (const category of rules.flatMap((rule) => rule ?? [])) {
    if (inBag.has(category.id)) continue;
    companionCounts.set(category.id, (companionCounts.get(category.id) ?? 0) + 1);
    companionPaths.set(category.id, category.path);
  }

  const complementsOf = new Map<string, number>();
  const companionProducts = (
    await Promise.all(
      [...companionPaths.entries()].map(async ([categoryId, categoryPath]) => {
        const products = await catalogue.bestsellers({ categoryPath, limit: 6 });
        const count = companionCounts.get(categoryId) ?? 1;
        for (const p of products) complementsOf.set(p.id, Math.max(complementsOf.get(p.id) ?? 0, count));
        return products;
      }),
    )
  ).flat();

  const candidates = [...coPurchased, ...companionProducts];
  if (!candidates.length) return [];

  // Accessories should sit at or below what the bag is built around.
  const bagCeiling = Math.max(...session.cart.map((p) => p.priceFrom));

  return rank(
    candidates,
    request,
    session,
    (c) => {
      const baskets = basketsWith.get(c.id) ?? 0;
      const complements = complementsOf.get(c.id) ?? 0;
      return (
        (baskets ? WEIGHTS.boughtTogether + Math.min(baskets, 10) * WEIGHTS.boughtTogetherPerBasket : 0) +
        (complements ? WEIGHTS.complementCategory + (complements - 1) * WEIGHTS.complementsMoreThanOne : 0) +
        (c.priceFrom <= bagCeiling ? WEIGHTS.priceAffinity : 0) +
        affinityScore(session.profile, c) * CONTEXT_AFFINITY_SHARE
      );
    },
    (c) => ({
      reason: basketsWith.has(c.id)
        ? { kind: 'bought-together', label: 'Often bought with items in your bag' }
        : { kind: 'complements-cart', label: 'Goes with items in your bag' },
      strategy: 'contextual',
    }),
  );
}

async function forSearch(
  request: NormalizedRecommendationRequest,
  catalogue: RecommendationCatalogue,
  session: SessionState,
): Promise<RankedRecommendation[]> {
  const query = request.context.query?.trim();
  if (!query) return forHomepage(request, catalogue, session);

  const hits = await catalogue.search(query, 24);
  if (!hits.length) return forHomepage(request, catalogue, session);

  /*
   * The departments the query landed in, weighted by how high their hits
   * ranked. Recommendations come from those departments' best sellers — so
   * "black sneakers" suggests more sneakers and footwear, not the whole
   * store — scored against the top hit as an anchor so colour/brand/specs of
   * what was searched still count.
   */
  const departmentWeight = new Map<string, number>();
  hits.forEach((hit, i) => {
    departmentWeight.set(hit.categoryId, (departmentWeight.get(hit.categoryId) ?? 0) + 1 / (i + 1));
  });
  const departments = [...departmentWeight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3);
  const topWeight = departments[0]?.[1] ?? 1;

  /* A leaf rarely holds enough on its own once the results already on screen
   * are excluded ("black sneakers" → every sneaker is a result), so each
   * department widens to its parent aisle — Sneakers → Shoes — but never to
   * the whole root department, where relevance to the query is gone. */
  const skip = blocked(request, session);
  const pools = await Promise.all(
    departments.map(async ([categoryId]) => {
      const leaf = await catalogue.categoryById(categoryId);
      if (!leaf) return [];
      const leafPool = await catalogue.bestsellers({ categoryPath: leaf.path, limit: request.limit * 2 });
      const fresh = leafPool.filter((p) => !skip.has(p.id));
      if (fresh.length >= request.limit || leaf.path.length < 3 || !leaf.parentId) return leafPool;
      const parent = await catalogue.categoryById(leaf.parentId);
      return parent
        ? [...leafPool, ...(await catalogue.bestsellers({ categoryPath: parent.path, limit: request.limit * 2 }))]
        : leafPool;
    }),
  );

  const anchor = hits[0];
  const candidates = [...hits, ...pools.flat()];

  return rank(
    candidates,
    request,
    session,
    (c) =>
      ((departmentWeight.get(c.categoryId) ?? 0) / topWeight) * WEIGHTS.categoryAffinity +
      similarityScore(anchor, c) * 0.25 +
      affinityScore(session.profile, c) * CONTEXT_AFFINITY_SHARE,
    () => ({ reason: { kind: 'related-to-search', label: 'Related to your search' }, strategy: 'contextual' }),
  );
}

async function forCategory(
  request: NormalizedRecommendationRequest,
  catalogue: RecommendationCatalogue,
  session: SessionState,
): Promise<RankedRecommendation[]> {
  const path = request.context.categoryPath;
  const category = path?.length ? await catalogue.categoryByPath(path) : null;
  if (!category) return forHomepage(request, catalogue, session);

  const pool = await catalogue.bestsellers({ categoryPath: category.path, limit: request.limit * POOL_FACTOR });

  /* Popularity is the context here, so it is weighted up rather than left as
   * a tie-breaker; a warm session reorders within what's popular. */
  const maxSold = Math.max(0, ...pool.map((p) => p.soldCount));
  return rank(
    pool,
    request,
    session,
    (c) =>
      (maxSold ? (Math.log1p(c.soldCount) / Math.log1p(maxSold)) * WEIGHTS.categoryAffinity : 0) +
      affinityScore(session.profile, c) * CONTEXT_AFFINITY_SHARE,
    () => ({
      reason: { kind: 'popular-in-category', label: `Popular in ${category.name}` },
      strategy: 'contextual',
    }),
  );
}

async function forHomepage(
  request: NormalizedRecommendationRequest,
  catalogue: RecommendationCatalogue,
  session: SessionState,
): Promise<RankedRecommendation[]> {
  // Cold start is the service's job — it owns the popular/new/curated ladder.
  if (session.profile.strength === 0) return [];

  /*
   * Candidates from the shopper's strongest departments (leaf categories
   * from the profile), plus similar products to their most recent signal
   * product. Strongest-first and id-tiebroken so the seed set is stable.
   */
  const leafSeeds = [...session.profile.categories.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  const seedCategories: string[][] = [];
  for (const id of leafSeeds) {
    if (seedCategories.length >= HOMEPAGE_CATEGORY_SEEDS) break;
    const category = await catalogue.categoryById(id);
    // Skip roots: "Fashion" as a seed is the whole store again.
    if (category && category.parentId !== null) seedCategories.push(category.path);
  }

  /*
   * A saved item says what the shopper is building towards, so its companion
   * aisles join the pool too — saved running shoes bring activewear and bags,
   * not only more shoes (§19). Nothing is added to or removed from the
   * wishlist; it is read, never written.
   */
  const signalCategories = new Set(
    [...session.viewed, ...session.wishlist, ...session.cart].map((p) => p.categoryId),
  );
  const wishlistCompanions = new Map(
    (await Promise.all(session.wishlist.map((item) => catalogue.companions(item.categoryId))))
      .flatMap((rule) => rule ?? [])
      .filter((category) => !signalCategories.has(category.id))
      .map((category) => [category.id, category.path] as const),
  );

  const [pools, companionPools] = await Promise.all([
    Promise.all(
      seedCategories.map((categoryPath) => catalogue.bestsellers({ categoryPath, limit: request.limit * 2 })),
    ),
    Promise.all(
      [...wishlistCompanions.values()].map((categoryPath) => catalogue.bestsellers({ categoryPath, limit: 4 })),
    ),
  ]);

  const wishlistComplements = new Set(companionPools.flat().map((p) => p.id));
  const candidates = [...pools.flat(), ...companionPools.flat()];
  if (!candidates.length) return [];

  return rank(
    candidates,
    request,
    session,
    (c) => affinityScore(session.profile, c) + (wishlistComplements.has(c.id) ? WEIGHTS.wishlistComplement : 0),
    (c) => ({
      reason:
        wishlistComplements.has(c.id) && !signalCategories.has(c.categoryId)
          ? { kind: 'wishlist-complement', label: 'Goes with items you saved' }
          : personalReason(session, c),
      strategy: 'personalized',
    }),
  );
}
