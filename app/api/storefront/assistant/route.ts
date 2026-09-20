/*
 * POST /api/storefront/assistant — the shopping assistant's only endpoint.
 *
 * proxy.ts excludes `/api` from the tenant rewrite, so the store is resolved
 * HERE, server-side, by resolveRequestStore(): from the hostname on a store's
 * own domain, from the page's /s/{slug} route on the mobile mall. That is the
 * tenant boundary (§9/§38): the client can send product ids, a category or a
 * cart, but it cannot choose a store — a body `org` naming a different store
 * is refused, and every id it sends is resolved through a catalogue already
 * scoped to the resolved store, so ids from elsewhere simply don't resolve.
 *
 * The route holds no AI logic. It validates, rate-limits, builds an
 * AssistantContext and hands off to lib/ai/assistant/service.ts, which owns
 * provider selection (§34/§42).
 *
 * Rate limits are per shopper (signed-in session, else IP) and per store —
 * see lib/ai/assistant/quota.ts. They are checked before any catalogue read
 * or model call, so a flood costs nothing but the check.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkAssistantRequest } from '@/lib/ai/assistant/quota';
import { askShoppingAssistant } from '@/lib/ai/assistant/service';
import { getProductBySlug } from '@/lib/storefront/catalog';
import { requestIdentity } from '@/lib/storefront/request-identity';
import { resolveRequestStore } from '@/lib/storefront/request-store';
import {
  MAX_HISTORY_TURNS,
  MAX_PRODUCTS_PER_ANSWER,
  type AssistantContext,
} from '@/lib/ai/assistant/types';

export const dynamic = 'force-dynamic';

/*
 * Bounded everywhere. The mock provider costs a few catalogue reads, but the
 * same shapes will later be a token bill, and an endpoint that accepts an
 * unbounded transcript is the one that pays for it (§36).
 */
const RequestSchema = z.object({
  /** optional cross-check from older clients; the store comes from the request (see above) */
  org: z.string().min(1).max(120).optional(),
  message: z.string().min(1).max(500),
  context: z
    .object({
      productId: z.string().max(120).optional(),
      productSlug: z.string().max(200).optional(),
      categoryPath: z.array(z.string().max(80)).max(4).optional(),
      collectionSlug: z.string().max(120).optional(),
      searchQuery: z.string().max(200).optional(),
      cartProductIds: z.array(z.string().max(120)).max(50).optional(),
      lastProductIds: z.array(z.string().max(120)).max(MAX_PRODUCTS_PER_ANSWER).optional(),
    })
    .optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(1000),
      }),
    )
    .max(MAX_HISTORY_TURNS)
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

  const { org, message, context = {}, history = [] } = parsed.data;

  const resolved = await resolveRequestStore(request, org);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const store = { organizationSlug: resolved.slug };

  const allowed = checkAssistantRequest(resolved.slug, requestIdentity(request, resolved.slug));
  if (!allowed.ok) {
    return NextResponse.json(
      { error: 'You’re sending messages a little fast. Give it a moment and try again.' },
      { status: 429, headers: { 'retry-after': String(allowed.retryAfterSeconds) } },
    );
  }

  /* A slug is what a page naturally has; resolve it to an id through THIS
   * store's catalogue so the provider only ever deals in ids it can look up. */
  let productId = context.productId;
  if (!productId && context.productSlug) {
    productId = (await getProductBySlug(context.productSlug, store))?.id;
  }

  const assistantContext: AssistantContext = {
    store,
    productId,
    categoryPath: context.categoryPath,
    collectionSlug: context.collectionSlug,
    searchQuery: context.searchQuery,
    cartProductIds: context.cartProductIds,
    lastProductIds: context.lastProductIds,
  };

  try {
    const response = await askShoppingAssistant({
      message,
      context: assistantContext,
      history,
    });
    return NextResponse.json(response);
  } catch (error) {
    // Logged server-side only; the shopper gets a plain sentence, never the error.
    console.error('[ai] assistant failed', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'The shopping assistant is unavailable right now.' },
      { status: 502 },
    );
  }
}
