/*
 * POST /api/storefront/recommendations — recommendation blocks that depend
 * on this browser's session (recently viewed, wishlist, bag, recent
 * searches), which the server cannot know when it renders the page.
 *
 * Top level for the same reason as the other storefront endpoints: proxy.ts
 * skips /api, so the store is resolved HERE by resolveRequestStore() — from
 * the hostname on a store's own domain, from the page's /s/{slug} route on
 * the mobile mall. A body `org` naming a different store is refused. The
 * client can send ids and a query; it cannot send products, and every id is
 * resolved through a catalogue scoped to the resolved store (§26).
 *
 * The route holds no recommendation logic — it validates and hands off to
 * lib/storefront/recommendations/service.ts, which owns the provider.
 * A POST because signal lists make for long, cache-hostile URLs, and because
 * behaviour has no business in server access logs.
 *
 * Rate-limited per shopper (signed-in session, else IP) and per store — see
 * lib/storefront/recommendations/quota.ts — before any catalogue read.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRecommendationRequest } from '@/lib/storefront/recommendations/quota';
import { requestIdentity } from '@/lib/storefront/request-identity';
import { resolveRequestStore } from '@/lib/storefront/request-store';
import { recommendProducts } from '@/lib/storefront/recommendations/service';
import {
  MAX_RECOMMENDATIONS,
  PLACEMENT_VALUES,
  SIGNAL_LIMITS,
} from '@/lib/storefront/recommendations/types';

export const dynamic = 'force-dynamic';

const id = z.string().max(120);
const path = z.array(z.string().max(80)).max(4);

const RequestSchema = z.object({
  /** optional cross-check from older clients; the store comes from the request (see above) */
  org: z.string().min(1).max(120).optional(),
  placement: z.enum(PLACEMENT_VALUES),
  limit: z.number().int().min(1).max(MAX_RECOMMENDATIONS).optional(),
  exclude: z.array(id).max(60).optional(),
  context: z
    .object({
      productId: id.optional(),
      categoryPath: path.optional(),
      query: z.string().max(200).optional(),
      signals: z
        .object({
          recentlyViewedIds: z.array(id).max(SIGNAL_LIMITS.recentlyViewedIds).optional(),
          wishlistIds: z.array(id).max(SIGNAL_LIMITS.wishlistIds).optional(),
          cartIds: z.array(id).max(SIGNAL_LIMITS.cartIds).optional(),
          recentQueries: z.array(z.string().max(80)).max(SIGNAL_LIMITS.recentQueries).optional(),
          recentCategoryPaths: z.array(path).max(SIGNAL_LIMITS.recentCategoryPaths).optional(),
        })
        .optional(),
    })
    .optional(),
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

  const { org, placement, limit, exclude, context = {} } = parsed.data;

  const resolved = await resolveRequestStore(request, org);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const allowed = checkRecommendationRequest(resolved.slug, requestIdentity(request, resolved.slug));
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      {
        status: 429,
        headers: { 'retry-after': String(allowed.retryAfterSeconds), 'Cache-Control': 'private, no-store' },
      },
    );
  }

  const response = await recommendProducts({
    store: { organizationSlug: resolved.slug },
    placement,
    limit,
    exclude,
    context,
  });

  return NextResponse.json(response, {
    // Personal to one session — never shared through a cache.
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
