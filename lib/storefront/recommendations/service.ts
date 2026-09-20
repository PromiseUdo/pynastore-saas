/*
 * The Recommendation Service — the one entry point the app calls.
 *
 *   pages / route ─▶ recommendProducts() ─▶ RecommendationProvider
 *                         │                   └─ rules (./rules-provider.ts)
 *                         └─▶ RecommendationCatalogue ─▶ Product Discovery
 *
 * Nothing outside this file names a provider. No component imports
 * ./rules-provider; adding another engine is a module implementing
 * RecommendationProvider, a line in PROVIDERS, and RECOMMENDATION_PROVIDER
 * set in the environment.
 *
 * What the service owns rather than the provider — so every provider
 * inherits it:
 *   • the tenant seam. The catalogue is built here from `request.store`.
 *   • sanitising signals: capped, trimmed, strings only.
 *   • GROUNDING: every ranked id is re-resolved through the scoped catalogue;
 *     an id the catalogue doesn't return (foreign, delisted, invented) is
 *     dropped. Out-of-stock and excluded products are dropped here too, so a
 *     provider bug can't put the current product or a bag item on screen.
 *   • the COLD-START LADDER (§13): personalized/contextual (provider) →
 *     trending/popular → new arrivals → curated. It pads the homepage and
 *     rescues any placement the provider returned nothing for, so a block is
 *     only ever empty when the store genuinely has nothing to show.
 *   • failure isolation (§31): a provider that throws degrades to the ladder;
 *     a catalogue that throws yields an empty response, never an exception.
 */
import { createRulesRecommendationProvider } from './rules-provider';
import { createRecommendationCatalogue } from './catalogue';
import {
  DEFAULT_RECOMMENDATIONS,
  MAX_RECOMMENDATIONS,
  SIGNAL_LIMITS,
  RecommendationError,
  type NormalizedRecommendationRequest,
  type RankedRecommendation,
  type RecommendationCatalogue,
  type RecommendationItem,
  type RecommendationProvider,
  type RecommendationRequest,
  type RecommendationResponse,
  type RecommendationSignals,
} from './types';
import type { Product, StoreScope } from '@/lib/storefront/types';

const PROVIDERS: Record<string, () => RecommendationProvider> = {
  rules: createRulesRecommendationProvider,
  /* the engine's name before it was renamed — kept so an existing env still works */
  mock: createRulesRecommendationProvider,
};

let cachedProvider: RecommendationProvider | null = null;
let catalogueFactory: (store: StoreScope) => RecommendationCatalogue = createRecommendationCatalogue;

/**
 * The configured provider. Falls back to the rules engine when the env names
 * something unregistered — a typo should degrade recommendations to their
 * deterministic mode, not take the storefront down.
 */
export function getRecommendationProvider(): RecommendationProvider {
  if (cachedProvider) return cachedProvider;
  const requested = process.env.RECOMMENDATION_PROVIDER?.trim() || 'rules';
  const factory = PROVIDERS[requested];
  if (!factory) {
    console.warn(
      `[recommendations] RECOMMENDATION_PROVIDER="${requested}" is not a registered provider; using "rules".`,
    );
  }
  cachedProvider = (factory ?? PROVIDERS.rules)();
  return cachedProvider;
}

/** Test seam — pin a provider without touching the environment. */
export function setRecommendationProvider(provider: RecommendationProvider | null): void {
  cachedProvider = provider;
}

/** Test seam — substitute the catalogue port (e.g. a two-tenant fake). */
export function setRecommendationCatalogueFactory(
  factory: ((store: StoreScope) => RecommendationCatalogue) | null,
): void {
  catalogueFactory = factory ?? createRecommendationCatalogue;
}

/* ────────────────────────────── sanitising ───────────────────────────── */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function cleanIds(ids: unknown, cap: number): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

function cleanStrings(values: unknown, cap: number, maxLength: number): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim().slice(0, maxLength))
        .filter(Boolean),
    ),
  ].slice(0, cap);
}

function cleanPath(path: unknown): string[] {
  return cleanStrings(path, 4, 80).filter((segment) => /^[a-z0-9-]+$/.test(segment));
}

export function normalizeSignals(signals: RecommendationSignals | undefined): Required<RecommendationSignals> {
  return {
    recentlyViewedIds: cleanIds(signals?.recentlyViewedIds, SIGNAL_LIMITS.recentlyViewedIds),
    wishlistIds: cleanIds(signals?.wishlistIds, SIGNAL_LIMITS.wishlistIds),
    cartIds: cleanIds(signals?.cartIds, SIGNAL_LIMITS.cartIds),
    recentQueries: cleanStrings(signals?.recentQueries, SIGNAL_LIMITS.recentQueries, 80),
    recentCategoryPaths: (Array.isArray(signals?.recentCategoryPaths) ? signals.recentCategoryPaths : [])
      .map(cleanPath)
      .filter((path) => path.length > 0)
      .slice(0, SIGNAL_LIMITS.recentCategoryPaths),
  };
}

export function normalizeRequest(request: RecommendationRequest): NormalizedRecommendationRequest {
  if (!request.store?.organizationSlug) {
    throw new RecommendationError('A store scope is required.', 'invalid_request');
  }
  const limit = Math.min(
    Math.max(Math.floor(request.limit ?? DEFAULT_RECOMMENDATIONS), 1),
    MAX_RECOMMENDATIONS,
  );
  const { context } = request;
  return {
    ...request,
    limit,
    exclude: cleanIds(request.exclude, 60),
    context: {
      productId: cleanIds([context.productId], 1)[0],
      categoryPath: context.categoryPath ? cleanPath(context.categoryPath) : undefined,
      query: context.query?.trim().slice(0, 200) || undefined,
      signals: normalizeSignals(context.signals),
    },
  };
}

/* ────────────────────────────── the ladder ───────────────────────────── */

/**
 * Cold-start rungs, in order. Each is a real catalogue read with an honest
 * reason: "Trending" only for rows the merchant tagged trending, "Popular"
 * for real sales, "New in" for real creation dates, "Featured" for the
 * merchant's own featured tag.
 */
async function fallbackCandidates(
  catalogue: RecommendationCatalogue,
  poolSize: number,
): Promise<RankedRecommendation[]> {
  const [trending, popular, newest, featured] = await Promise.all([
    catalogue.tagged('trending', poolSize),
    catalogue.bestsellers({ limit: poolSize }),
    catalogue.newest(poolSize),
    catalogue.tagged('featured', poolSize),
  ]);

  // Scores descend across rungs so the service's final sort keeps ladder order.
  const rung = (products: Product[], base: number, make: () => Omit<RankedRecommendation, 'productId' | 'score'>) =>
    products.map((p, i) => ({ productId: p.id, score: base - i, ...make() }));

  return [
    ...rung(trending, -1_000, () => ({ reason: { kind: 'trending', label: 'Trending in this store' }, strategy: 'popular' })),
    ...rung(popular, -2_000, () => ({ reason: { kind: 'popular', label: 'Popular in this store' }, strategy: 'popular' })),
    ...rung(newest, -3_000, () => ({ reason: { kind: 'new-arrival', label: 'New in' }, strategy: 'new-arrivals' })),
    ...rung(featured, -4_000, () => ({ reason: { kind: 'featured', label: 'Featured' }, strategy: 'curated' })),
  ];
}

const empty = (request: RecommendationRequest, degraded: boolean): RecommendationResponse => ({
  placement: request.placement,
  items: [],
  total: 0,
  strategy: null,
  degraded,
});

/* ─────────────────────────────── entry ───────────────────────────────── */

/**
 * Recommend products for a placement.
 *
 * Never throws for a provider or catalogue failure — recommendations are
 * never a critical dependency of the page they sit on. An invalid request
 * (no store) is still an error, because that is a programming mistake.
 */
export async function recommendProducts(request: RecommendationRequest): Promise<RecommendationResponse> {
  const normalized = normalizeRequest(request);
  const catalogue = catalogueFactory(normalized.store);
  const provider = getRecommendationProvider();

  let ranked: RankedRecommendation[] = [];
  let degraded = false;
  try {
    ranked = await provider.recommend(normalized, catalogue);
  } catch (error) {
    console.error(`[recommendations] provider "${provider.name}" failed`, error);
    degraded = true;
  }

  try {
    const blocked = new Set([
      ...normalized.exclude,
      ...(normalized.context.productId ? [normalized.context.productId] : []),
      ...normalized.context.signals.cartIds,
    ]);

    let items = await ground(ranked, catalogue, blocked, normalized.limit);

    /*
     * The ladder pads the homepage ("never an empty Recommended for you") and
     * rescues any placement the provider left empty. It does NOT pad a
     * contextual block that already has relevant products: four sneakers
     * under a sneaker search beat four sneakers plus a pillow (§16).
     */
    const pad = normalized.placement === 'homepage' || items.length === 0;
    if (pad && items.length < normalized.limit) {
      const fallback = await fallbackCandidates(catalogue, normalized.limit * 2 + blocked.size);
      const taken = new Set([...blocked, ...items.map((i) => i.product.id)]);
      // Viewed products are a weak fit for a "discover" rung — push them last.
      const viewed = new Set(normalized.context.signals.recentlyViewedIds);
      const ordered = [
        ...fallback.filter((f) => !viewed.has(f.productId)),
        ...fallback.filter((f) => viewed.has(f.productId)),
      ];
      const extra = await ground(ordered, catalogue, taken, normalized.limit - items.length, true);
      items = [...items, ...extra];
    }

    const ranks = items.map((item, i) => ({ ...item, rank: i + 1 }));
    return {
      placement: normalized.placement,
      items: ranks,
      total: ranks.length,
      strategy: ranks[0]?.strategy ?? null,
      degraded,
    };
  } catch (error) {
    console.error('[recommendations] catalogue failed', error);
    return empty(request, true);
  }
}

/**
 * Turn ranked ids into products — through Product Discovery, never trusting
 * the provider's ids to exist, be in this store, or be buyable.
 */
async function ground(
  ranked: RankedRecommendation[],
  catalogue: RecommendationCatalogue,
  blocked: Set<string>,
  limit: number,
  keepOrder = false,
): Promise<Omit<RecommendationItem, 'rank'>[]> {
  if (limit <= 0 || !ranked.length) return [];

  const unique = new Map<string, RankedRecommendation>();
  for (const entry of ranked) {
    if (blocked.has(entry.productId) || unique.has(entry.productId)) continue;
    if (!Number.isFinite(entry.score)) continue;
    unique.set(entry.productId, entry);
  }

  const products = await catalogue.productsByIds([...unique.keys()]);
  const byId = new Map(products.map((p) => [p.id, p]));

  const entries = [...unique.values()].flatMap((entry) => {
    const product = byId.get(entry.productId);
    return product?.inStock ? [{ entry, product }] : [];
  });
  if (!keepOrder) {
    entries.sort(
      (a, b) => b.entry.score - a.entry.score || a.entry.productId.localeCompare(b.entry.productId),
    );
  }

  return entries.slice(0, limit).map(({ entry, product }) => ({
    product,
    reason: entry.reason,
    score: entry.score,
    strategy: entry.strategy,
  }));
}
