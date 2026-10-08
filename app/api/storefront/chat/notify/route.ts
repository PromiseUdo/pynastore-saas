/*
 * POST /api/storefront/chat/notify — a shopper in a store's own app turns on
 * notifications for the store's replies (ROADMAP 17.4). Body:
 * { deviceToken, org? }.
 *
 * Everything else is decided from the request: the store (chatStoreFromRequest),
 * the app and phone (user agent), the conversation (who they are). It only
 * links a phone to a conversation that already exists — there is nothing to
 * be told about before the first message. JSON only, like the other chat routes.
 */
import { NextResponse } from 'next/server';
import { chatStoreFromRequest } from '@/lib/chat/storefront';
import { currentChatIdentity } from '@/lib/chat/identity';
import { watchChatReplies, type ChatWatchResult } from '@/lib/chat/push';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const STATUS: Record<ChatWatchResult, number> = { watching: 200, unavailable: 409, 'not-found': 404, 'invalid-token': 400 };

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415, headers: NO_STORE });
  }
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  if (typeof input.deviceToken !== 'string') return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE });

  const found = await chatStoreFromRequest(request, typeof input.org === 'string' ? input.org : null);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });

  const result = await watchChatReplies({
    store: found.store,
    identity: await currentChatIdentity(found.store),
    deviceToken: input.deviceToken,
    userAgent: request.headers.get('user-agent'),
  });
  return NextResponse.json({ result }, { status: STATUS[result], headers: NO_STORE });
}
