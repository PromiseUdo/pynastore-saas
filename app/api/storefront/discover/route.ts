/*
 * POST /api/storefront/discover — the one endpoint behind every discovery
 * entry point on the homepage (natural-language search, shopping missions,
 * budget bands, and the guided "Help me choose" flow).
 *
 * It does exactly one thing: turn a request into `ListProductsParams` and ask
 * the catalogue. It never composes prose about products and never returns a
 * field the catalogue didn't supply.
 *
 * STORE. proxy.ts skips `/api`, so this route resolves its store itself with
 * resolveRequestStore() — from the hostname on a store's own domain, from the
 * page's /s/{slug} route on the mobile mall — and uses that as the scope for
 * every query below. A body `org` is only a cross-check: one that names a
 * different store is refused, so a request can't be pointed at another
 * merchant's catalogue.
 *
 * LIMITS. Rate-limited per shopper and per store (lib/storefront/
 * discovery-quota.ts) before any catalogue read.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkDiscoveryRequest } from '@/lib/storefront/discovery-quota';
import { requestIdentity } from '@/lib/storefront/request-identity';
import { resolveRequestStore } from '@/lib/storefront/request-store';
import { listProducts } from '@/lib/storefront/catalog';
import {
  buildIntentVocabulary,
  getMissionById,
  getStoreCurrency,
} from '@/lib/storefront/discovery';
import { parseShoppingIntent } from '@/lib/ai/intent';
import { intentToQuery, type ShoppingIntent } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  /** optional cross-check from older clients; the store comes from the request (see above) */
  org: z.string().min(1).max(120).optional(),
  /** free text from the hero input */
  q: z.string().max(300).optional(),
  /** a shopping mission id (lib/storefront/discovery.ts) */
  mission: z.string().max(60).optional(),
  minPrice: z.number().int().nonnegative().optional(),
  maxPrice: z.number().int().positive().optional(),
  sort: z
    .enum(['relevance', 'newest', 'price-asc', 'price-desc', 'rating', 'bestselling'])
    .optional(),
  limit: z.number().int().min(1).max(24).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const { org, q, mission, minPrice, maxPrice, sort, limit = 8 } = parsed.data;

  const resolved = await resolveRequestStore(request, org);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const allowed = checkDiscoveryRequest(resolved.slug, requestIdentity(request, resolved.slug));
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'You’re searching a little fast. Give it a moment and try again.' },
      { status: 429, headers: { 'retry-after': String(allowed.retryAfterSeconds) } },
    );
  }

  const store = { organizationSlug: resolved.slug };

  const currency = await getStoreCurrency(store);

  /* Free text → structured constraints. Today this is the deterministic
   * parser in lib/ai/intent.ts; swapping in an LLM changes only this call. */
  let intent: ShoppingIntent = { recognised: [] };
  if (q?.trim()) {
    const vocab = await buildIntentVocabulary(currency, store);
    intent = parseShoppingIntent(q, vocab);
  }

  /* A mission contributes its category subtree; explicit controls (a budget
   * band, a sort) always win over anything inferred from the text. */
  const missionDef = mission ? getMissionById(mission) : undefined;

  const base = {
    store,
    ...intentToQuery(intent),
    ...(missionDef?.match ?? {}),
    ...(minPrice != null ? { minPrice } : {}),
    ...(maxPrice != null ? { maxPrice } : {}),
    ...(sort ? { sort } : {}),
    perPage: limit,
  };

  let { items, total } = await listProducts(base);

  /*
   * Broaden rather than dead-end.
   *
   * `listProducts` ANDs its free-text `query` against name/brand/description,
   * so use-case words survive parsing but match no product text: "a laptop for
   * programming under 1.2m" filters real laptops down to zero because no
   * laptop's copy contains "programming". When the search found nothing AND we
   * still hold a structured constraint worth honouring (a category, a brand or
   * a budget), drop the leftover words and answer that instead.
   *
   * The response says so, so the shopper isn't told these are exact matches.
   * A query with no structured constraint at all is left at zero — nonsense
   * input should return nothing, not the entire catalogue.
   */
  const hasStructuredConstraint =
    !!base.categoryPath?.length ||
    !!base.brandSlugs?.length ||
    base.minPrice != null ||
    base.maxPrice != null;

  let broadened = false;
  if (total === 0 && base.query && hasStructuredConstraint) {
    const { query: _dropped, ...withoutText } = base;
    ({ items, total } = await listProducts(withoutText));
    broadened = total > 0;
  }

  return NextResponse.json({
    products: items,
    total,
    currency,
    // Keyword chips are dropped when they were not actually applied — showing
    // "understood: programming" next to results it did not filter would lie.
    recognised: broadened ? intent.recognised.filter((r) => r.kind !== 'keyword') : intent.recognised,
    broadened,
    mission: missionDef ? { id: missionDef.id, label: missionDef.label } : null,
  });
}
