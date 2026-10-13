/*
 * lib/notifications/web-push-route.ts
 *
 * What the three "notifications on this browser" routes answer (ROADMAP
 * 18.3): POST to subscribe, DELETE to stop. Each route decides the OWNER from
 * the session — a member in this shop, platform staff, a shopper or a guest —
 * and hands it here; nothing in the body can say whose it is.
 *
 *   POST    { subscription: PushSubscription.toJSON() }   → { ok: true }
 *   DELETE  { endpoint } (this browser) or { id } (one from the list)
 *
 * JSON only, from a page on this same host (the Origin must match the Host:
 * the subscription belongs to that origin, and is opened there when tapped),
 * and limited per person and address (13.2).
 */
import { checkRateLimit } from '@/lib/rate-limit';
import { webPushConfigured } from './channels/web-push';
import { parseSubscription, removeSubscription, saveSubscription, type BrowserOwner } from './web-push-subscriptions';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Changes per person (or guest) and address, per 10 minutes. */
const CHANGES_PER_10_MIN = 20;

/** The page's origin, when it's this same host; null otherwise. */
export function sameOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return null;
  try {
    const url = new URL(origin);
    return url.host === host ? url.origin : null;
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
}

async function allowed(request: Request, owner: BrowserOwner): Promise<boolean> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  const who = owner.userId ?? owner.customerId ?? owner.guestKeyHash ?? 'guest';
  return checkRateLimit(`webpush:${owner.audience}:${who}:${ip}`, CHANGES_PER_10_MIN, 10 * 60_000);
}

/**
 * Subscribe this browser. `body` is the already-read request body when the
 * route needed it first (a shopper's order token); `orderId` makes it watch
 * that order.
 */
export async function subscribeBrowser(
  request: Request,
  owner: BrowserOwner,
  options: { body?: Record<string, unknown>; orderId?: string | null } = {},
): Promise<Response> {
  const body = options.body ?? (await readBody(request));
  if (body instanceof Response) return body;
  if (!webPushConfigured()) return json({ error: 'Browser notifications aren’t set up.' }, 503);
  const origin = sameOrigin(request);
  if (!origin) return json({ error: 'Not from this site.' }, 403);
  const subscription = parseSubscription(body.subscription);
  if (!subscription) return json({ error: 'That isn’t a browser notification subscription.' }, 400);
  if (!(await allowed(request, owner))) return json({ error: 'Too many requests.' }, 429);

  await saveSubscription(owner, subscription, { origin, userAgent: request.headers.get('user-agent'), orderId: options.orderId });
  return json({ ok: true });
}

export async function unsubscribeBrowser(request: Request, owner: BrowserOwner): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (!sameOrigin(request)) return json({ error: 'Not from this site.' }, 403);
  if (!(await allowed(request, owner))) return json({ error: 'Too many requests.' }, 429);
  const endpoint = typeof body.endpoint === 'string' && body.endpoint.length <= 1024 ? body.endpoint : undefined;
  const id = typeof body.id === 'string' && body.id.length <= 64 ? body.id : undefined;
  const removed = await removeSubscription(owner, { endpoint, id });
  return json({ ok: removed });
}

/** Read the body once, for a route that needs a field from it before subscribing. */
export { readBody as readWebPushBody };
