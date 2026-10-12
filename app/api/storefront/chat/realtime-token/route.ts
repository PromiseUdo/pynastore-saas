/*
 * POST /api/storefront/chat/realtime-token — a listen-only Ably token for the
 * shopper's own conversation (Messages, real-time). Body: { org? }.
 *
 * The browser names nothing: the store comes from the request
 * (chatStoreFromRequest), the shopper from their session or guest cookie,
 * and the conversation from who they are. The token can only `subscribe`, to
 * exactly chat:{organizationId}:{conversationId}. No conversation yet → 404
 * (the panel asks again after the first message); Ably not configured → 503
 * (the panel keeps polling). Each renewal comes back here, so a shopper who
 * signs out, or a conversation deleted under data rights, stops being renewed.
 *
 * JSON only, like the other chat routes, and limited per address — each
 * request reads the database.
 */
import { NextResponse } from 'next/server';
import { chatStoreFromRequest } from '@/lib/chat/storefront';
import { currentChatIdentity } from '@/lib/chat/identity';
import { shopperConversationId } from '@/lib/chat/service';
import { ablyConfigured, chatChannelName, listenTokenRequest } from '@/lib/chat/ably';
import { checkRateLimit } from '@/lib/rate-limit';
import { requestIdentity } from '@/lib/storefront/request-identity';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
/** Generous for a person (a token lasts an hour), tight for a script. */
const TOKENS_PER_IP_PER_10_MIN = 30;

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415, headers: NO_STORE });
  }
  if (!ablyConfigured()) return NextResponse.json({ error: 'Real-time updates are off.' }, { status: 503, headers: NO_STORE });

  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }

  const found = await chatStoreFromRequest(request, typeof input.org === 'string' ? input.org : null);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });
  const { store } = found;

  const ip = requestIdentity(request, store.slug).ip;
  if (!(await checkRateLimit(`chat:token:${store.slug}:${ip}`, TOKENS_PER_IP_PER_10_MIN, 10 * 60_000))) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: NO_STORE });
  }

  const conversationId = await shopperConversationId(store.organizationId, await currentChatIdentity(store));
  if (!conversationId) return NextResponse.json({ error: 'No conversation yet.' }, { status: 404, headers: NO_STORE });

  const channel = chatChannelName(store.organizationId, conversationId);
  const tokenRequest = await listenTokenRequest([channel]);
  if (!tokenRequest) return NextResponse.json({ error: 'Real-time updates are off.' }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ tokenRequest, channel }, { headers: NO_STORE });
}
