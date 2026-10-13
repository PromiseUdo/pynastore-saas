/*
 * POST /api/storefront/chat/away — the shopper closed the chat, or the app or
 * tab went into the background. Body: { org? }.
 *
 * Their next reply from the store is then pushed at once, rather than held
 * back as if they were still looking (lib/chat/alerts.ts). The store comes
 * from the request and the conversation from who they are, as in every chat
 * route; it only ever clears the asker's own "looking" mark. Sent with
 * `keepalive`, so it survives the page going away. JSON only.
 */
import { NextResponse } from 'next/server';
import { chatStoreFromRequest } from '@/lib/chat/storefront';
import { currentChatIdentity } from '@/lib/chat/identity';
import { markShopperAway } from '@/lib/chat/service';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415, headers: NO_STORE });
  }
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
  } catch {
    // An empty body is fine: the store comes from the request.
  }

  const found = await chatStoreFromRequest(request, typeof input.org === 'string' ? input.org : null);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });

  const identity = await currentChatIdentity(found.store);
  if (identity) await markShopperAway(found.store.organizationId, identity);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
