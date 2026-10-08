/*
 * GET /api/storefront/chat — the shopper's own conversation with this store
 * (ROADMAP 17.3). What the chat panel polls.
 *
 *   ?after=N   messages newer than N (a poll)
 *   ?before=N  the page before N ("Load earlier")
 *   neither    the latest page
 *   ?summary=1 just the conversation's state (unread, blocked) — the
 *              background check while the panel is closed
 *   ?open=1    the panel is on screen — noted (throttled), so the reply push
 *              (17.4) doesn't buzz a phone that's already showing it
 *   ?org=slug  optional cross-check; the store comes from the request itself
 *
 * There is no conversation id anywhere: the shopper's conversation is found
 * from who they are (session or guest cookie), so there is nothing to swap
 * for someone else's. Someone who has never written gets an empty answer,
 * and no cookie.
 */
import { NextResponse } from 'next/server';
import { chatStoreFromRequest } from '@/lib/chat/storefront';
import { currentChatIdentity } from '@/lib/chat/identity';
import { chatAvailability, getShopperChat } from '@/lib/chat/service';
import { MAX_SEQ, parseSeq } from '@/lib/chat/rules';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const found = await chatStoreFromRequest(request, url.searchParams.get('org'));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });
  const { store } = found;

  /* ?summary=1 is the background unread check: the conversation's state,
   * no messages. */
  const after = url.searchParams.get('summary') === '1' ? MAX_SEQ : parseSeq(url.searchParams.get('after'));
  const before = parseSeq(url.searchParams.get('before'));

  const [identity, availability] = await Promise.all([currentChatIdentity(store), chatAvailability(store.organizationId)]);
  const chat = await getShopperChat(
    store.organizationId,
    identity,
    before !== undefined ? { before } : after !== undefined ? { after } : {},
    { markSeen: url.searchParams.get('open') === '1' },
  );

  return NextResponse.json({ ...chat, open: availability.open }, { headers: NO_STORE });
}
