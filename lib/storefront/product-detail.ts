/*
 * lib/storefront/product-detail.ts
 *
 * The Product Detail Service — everything a PDP needs, in one await.
 *
 *     /products/[slug] ──▶ loadProductPage() ──▶ catalog.ts ──▶ fixtures
 *                                    │                          (later: API)
 *                                    └──▶ listProducts()  ← the same engine
 *                                         /search and /c/… use
 *
 * The recommendation sets below are the reason this file exists. They are
 * built from `listProducts()` queries — same filters, same sorting, same
 * tenant seam — rather than from a second matching implementation. Which
 * means: when the catalogue moves onto the backend, "cheaper alternatives"
 * moves with it for free, and there is no recommender left behind still
 * reading fixtures.
 *
 * Everything here is deterministic. No model, no embeddings, no external
 * call — a ranking a human can predict and a test can pin down.
 *
 * Server-only: it reads the catalogue.
 */
import {
  getBrandById,
  getBreadcrumb,
  getCategoryById,
  getCompanionCategories,
  getDeliveryPromise,
  getFrequentlyBoughtTogether,
  getProductBySlug,
  getProductQuestions,
  getReviews,
  listProducts,
} from './catalog';
import { getShopper } from './account/session';
import { reviewOpportunity, votedReviewIds, type ReviewOpportunity } from './reviews/read';
import { pendingQuestionsOf, type PendingQuestion } from './questions/read';
import { DEFAULT_COMPANION_TITLE, interleave } from './recommendations/complements';
import { similarityScore } from './recommendations/scoring';
import type {
  Category,
  DeliveryPromise,
  Product,
  ProductQuestion,
  ProductRecommendations,
  Review,
  StoreScope,
} from './types';

/** How many products each rail shows. */
const RAIL_SIZE = 8;

/** Reviews rendered on the server; the rest are a click away, not a request. */
const REVIEWS_ON_PAGE = 8;

/**
 * A price has to move by more than this to count as a cheaper or premium
 * alternative. Without it the rails fill with the same product at ±2%, which
 * answers nobody's question.
 */
const PRICE_MARGIN = 0.1;

export interface ProductPageData {
  product: Product;
  /** root → … → the product's own category */
  breadcrumb: Category[];
  /** the deepest category the product sits in */
  category: Category | null;
  reviews: {
    items: Review[];
    total: number;
    /** whether the viewer bought this product, and what they already wrote */
    viewer: ReviewOpportunity;
    /** reviews on this page the viewer has already found helpful */
    votedIds: string[];
    /** null for a guest — the section then invites them to sign in */
    signedIn: boolean;
  };
  questions: {
    /** the pairs the merchant published */
    items: ProductQuestion[];
    /** the viewer's own questions, still waiting for an answer */
    pending: PendingQuestion[];
    /** false for a guest — the section then invites them to sign in to ask */
    signedIn: boolean;
  };
  delivery: DeliveryPromise;
  recommendations: ProductRecommendations;
}

/**
 * Load a product page by slug, scoped to a store.
 *
 * Returns null rather than throwing for an unknown slug: "no such product"
 * is an ordinary outcome the route turns into a 404, not an exception.
 */
export async function loadProductPage(
  slug: string,
  store: StoreScope,
): Promise<ProductPageData | null> {
  const product = await getProductBySlug(slug, store);
  if (!product) return null;

  const category = await getCategoryById(product.categoryId, store);

  const [breadcrumb, reviews, questions, delivery, recommendations, shopper] = await Promise.all([
    category ? getBreadcrumb(category, store) : Promise.resolve([]),
    getReviews(product.id, { sort: 'helpful', perPage: REVIEWS_ON_PAGE }, store),
    getProductQuestions(product.id, store),
    getDeliveryPromise(store),
    getRecommendations(product, store),
    getShopper(),
  ]);

  /* Who the reader is changes two sections: whether there's a review form
   * and which reviews already have their vote, and whether a question of
   * their own is still waiting downstairs. Resolved here so the page itself
   * stays a composition. */
  const [viewer, voted, pendingQuestions] = await Promise.all([
    shopper
      ? reviewOpportunity({
          organizationId: shopper.organizationId,
          customerId: shopper.id,
          productId: product.id,
        })
      : Promise.resolve({ canReview: false, orderId: null, own: null } satisfies ReviewOpportunity),
    votedReviewIds(shopper?.id ?? null, reviews.items.map((r) => r.id)),
    shopper
      ? pendingQuestionsOf({
          organizationId: shopper.organizationId,
          customerId: shopper.id,
          productId: product.id,
        })
      : Promise.resolve([] as PendingQuestion[]),
  ]);

  return {
    product,
    breadcrumb,
    category,
    reviews: {
      items: reviews.items,
      total: reviews.total,
      viewer,
      votedIds: [...voted],
      signedIn: Boolean(shopper),
    },
    questions: {
      items: questions,
      pending: pendingQuestions,
      signedIn: Boolean(shopper),
    },
    delivery,
    recommendations,
  };
}

/* ───────────────────────── recommendations ───────────────────────── */

/**
 * Candidates from the closest category that has enough of them.
 *
 * Starts at the product's own leaf and walks UP the tree only while the pool
 * is too thin — so a shirt is compared against shirts, and only widens to
 * menswear when there are barely any shirts. Widening by default is how
 * "similar products" ends up meaning "other things this shop sells".
 */
async function relatedPool(
  product: Product,
  store: StoreScope,
  minimum: number,
): Promise<Product[]> {
  const ancestry = [...product.categoryIds].reverse(); // leaf first

  let pool: Product[] = [];
  for (const categoryId of ancestry) {
    const category = await getCategoryById(categoryId, store);
    if (!category) continue;

    const { items } = await listProducts({
      store,
      categoryPath: category.path,
      perPage: 200,
      sort: 'bestselling',
    });
    pool = items.filter((p) => p.id !== product.id);
    if (pool.length >= minimum) break;
  }

  return pool;
}

/**
 * How close two products are, as a number — the recommendation layer's
 * `similarityScore`, so this page's rails and the "You may also like" block
 * can never disagree about what "similar" means.
 */
const relevanceScore = similarityScore;

const byRelevance = (product: Product) => (a: Product, b: Product) =>
  relevanceScore(product, b) - relevanceScore(product, a);

/**
 * Every rail on the page, built from one pool.
 *
 * Each set answers a different question a shopper actually asks — "what else
 * is like this?", "is there a cheaper one?", "what's the better version?",
 * "what do I need with it?" — so they are allowed to overlap in candidates
 * but never in intent.
 */
export async function getRecommendations(
  product: Product,
  store: StoreScope,
): Promise<ProductRecommendations> {
  const pool = await relatedPool(product, store, RAIL_SIZE);

  const similar = [...pool].sort(byRelevance(product)).slice(0, RAIL_SIZE);

  // Through the brand filter the listing pages use, not a scan of everything.
  const brand = await getBrandById(product.brandId, store);
  const { items: brandItems } = brand
    ? await listProducts({ store, brandSlugs: [brand.slug], perPage: 50, sort: 'bestselling' })
    : { items: [] as Product[] };
  const fromBrand = brandItems.filter((p) => p.id !== product.id).slice(0, RAIL_SIZE);

  /*
   * Cheaper: relevance FIRST, then the closest lower price. Sorting the
   * catalogue by price would answer "what is cheap here?" — which is not the
   * question. The shopper is holding this product and wants the nearest
   * thing to it that costs less.
   */
  const cheaperCeiling = product.priceFrom * (1 - PRICE_MARGIN);
  const cheaper = pool
    .filter((p) => p.priceFrom <= cheaperCeiling && p.inStock)
    .sort(
      (a, b) =>
        relevanceScore(product, b) - relevanceScore(product, a) ||
        b.priceFrom - a.priceFrom, // closest to the current price first
    )
    .slice(0, RAIL_SIZE);

  /*
   * Premium: costs more AND is demonstrably better on something real — rated
   * higher or selling harder. "More expensive" on its own is not an upgrade,
   * and presenting it as one would be the dishonest version of this rail.
   */
  const premiumFloor = product.priceFrom * (1 + PRICE_MARGIN);
  const premium = pool
    .filter(
      (p) =>
        p.priceFrom >= premiumFloor &&
        p.inStock &&
        (p.rating.average >= product.rating.average || p.soldCount > product.soldCount),
    )
    .sort(
      (a, b) =>
        relevanceScore(product, b) - relevanceScore(product, a) ||
        b.rating.average - a.rating.average ||
        a.priceFrom - b.priceFrom, // closest step up first
    )
    .slice(0, RAIL_SIZE);

  // Independent reads, so neither waits on the other; overlap is removed after.
  const [pairs, companions] = await Promise.all([
    getFrequentlyBoughtTogether(product.id, RAIL_SIZE, store),
    getCompanions(product, store),
  ]);
  const boughtTogether = pairs.map((e) => e.product);
  const shown = new Set(boughtTogether.map((p) => p.id));

  return {
    similar,
    fromBrand,
    cheaper,
    premium,
    boughtTogether,
    // Round-robin so every companion aisle is represented before any repeats,
    // leaving out what the "Often bought together" rail already shows.
    completeTheLook: interleave(
      companions.lists.map((list) => list.filter((p) => !shown.has(p.id))),
      RAIL_SIZE,
    ),
    completeTheLookTitle: companions.title,
  };
}

/**
 * "Complete the look" / "You may also need".
 *
 * Driven by the merchant's own "Goes well with" categories for this
 * product's category (Inventory › Categories), not by product, so nothing is
 * hand-picked per row. Where the merchant hasn't set any, it falls back to
 * the sibling aisles — a weaker answer but never an empty or a wrong one.
 * Returns one candidate list per aisle, longer than the rail, so the caller
 * can drop what the "Often bought together" rail shows and still fill it.
 */
async function getCompanions(
  product: Product,
  store: StoreScope,
): Promise<{ title: string; lists: Product[][] }> {
  const keep = (p: Product) => p.id !== product.id && p.inStock;
  const rule = product.categoryId ? await getCompanionCategories(product.categoryId, store) : null;

  if (!rule?.categories.length) {
    const category = await getCategoryById(product.categoryId, store);
    if (!category?.parentId) return { title: DEFAULT_COMPANION_TITLE, lists: [] };
    // Structural fallback: the other aisles beside this one.
    const parent = await getCategoryById(category.parentId, store);
    const { items } = await listProducts({
      store,
      categoryPath: parent?.path,
      perPage: 200,
      sort: 'bestselling',
    });
    return {
      title: DEFAULT_COMPANION_TITLE,
      lists: [items.filter((p) => p.categoryId !== product.categoryId && keep(p)).slice(0, RAIL_SIZE * 2)],
    };
  }

  /*
   * One query per companion category, taking the best sellers from each, so
   * the rail is a spread across the companion aisles rather than four socks.
   */
  const perCategory = await Promise.all(
    rule.categories.map(async (category) => {
      const { items } = await listProducts({
        store,
        categoryPath: category.path,
        perPage: 4 + RAIL_SIZE,
        sort: 'bestselling',
      });
      return items.filter(keep);
    }),
  );

  return { title: rule.title ?? DEFAULT_COMPANION_TITLE, lists: perCategory };
}

/**
 * Products for a list of ids, in the order given.
 *
 * Backs the "recently viewed" rail, whose ids live in the browser and reach
 * the server only as a request — the client never gets to send product data,
 * only references it. Unknown ids are dropped silently: a product that has
 * since been delisted should quietly disappear from the rail.
 */
export async function getProductsForIds(ids: string[], store: StoreScope): Promise<Product[]> {
  if (!ids.length) return [];
  const { items } = await listProducts({ store, productIds: ids, perPage: ids.length });
  const byId = new Map(items.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
}
