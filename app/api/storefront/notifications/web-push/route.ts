/*
 * /api/storefront/notifications/web-push — a shopper's browser asking to be
 * told (ROADMAP 18.3). POST subscribes, DELETE stops.
 *
 * The store comes from the request the proxy's way (resolveRequestStore) —
 * on the shop's own host, never the store app's mobile host, which has phone
 * notifications instead. Who it's for comes from the session:
 *
 *   signed in   their account: every order and reply that's theirs
 *   a guest     the order they're looking at (`order`: its confirmation
 *               token, checked against this store) and their chat, if their
 *               browser has one with this store
 *
 * A guest with neither has nothing to hear about, and is refused.
 */
import { prisma } from '@/lib/prisma';
import { resolveRequestStore } from '@/lib/storefront/request-store';
import { currentChatIdentity } from '@/lib/chat/identity';
import { readWebPushBody, subscribeBrowser, unsubscribeBrowser } from '@/lib/notifications/web-push-route';
import type { BrowserOwner } from '@/lib/notifications/web-push-subscriptions';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function store(request: Request): Promise<{ error: Response } | { slug: string; organizationId: string }> {
  const resolved = await resolveRequestStore(request);
  if (!resolved.ok) return { error: json({ error: resolved.error }, resolved.status) };
  if (resolved.via !== 'host') return { error: json({ error: 'Not a storefront request.' }, 400) };
  const org = await prisma.organization.findFirst({ where: { slug: resolved.slug, status: 'ACTIVE' }, select: { id: true } });
  if (!org) return { error: json({ error: 'Store not found.' }, 404) };
  return { slug: resolved.slug, organizationId: org.id };
}

async function ownerFor(found: { slug: string; organizationId: string }): Promise<BrowserOwner> {
  const identity = await currentChatIdentity(found);
  if (identity?.kind === 'customer') return { audience: 'SHOPPER', organizationId: found.organizationId, customerId: identity.customerId };
  return { audience: 'SHOPPER', organizationId: found.organizationId, guestKeyHash: identity?.guestKeyHash ?? null };
}

export async function POST(request: Request) {
  const found = await store(request);
  if ('error' in found) return found.error;
  const body = await readWebPushBody(request);
  if (body instanceof Response) return body;
  const owner = await ownerFor(found);

  let orderId: string | null = null;
  if (typeof body.order === 'string' && body.order.length <= 128) {
    const order = await prisma.order.findFirst({
      where: { organizationId: found.organizationId, confirmationToken: body.order },
      select: { id: true },
    });
    if (!order) return json({ error: 'Order not found.' }, 404);
    orderId = order.id;
  }
  if (!owner.customerId && !owner.guestKeyHash && !orderId) return json({ error: 'Nothing to tell you about yet.' }, 404);

  return subscribeBrowser(request, owner, { body, orderId });
}

export async function DELETE(request: Request) {
  const found = await store(request);
  if ('error' in found) return found.error;
  return unsubscribeBrowser(request, await ownerFor(found));
}
