/*
 * POST /api/storefront/chat/read — the shopper has seen the store's
 * messages up to `upTo` (ROADMAP 17.3). Body: { upTo, org? }.
 *
 * Moves only their own conversation's mark, found from who they are, and
 * never backwards. JSON only, like the send route.
 */
import { NextResponse } from 'next/server';
import { chatStoreFromRequest } from '@/lib/chat/storefront';
import { currentChatIdentity } from '@/lib/chat/identity';
import { markReadByCustomer } from '@/lib/chat/service';

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
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const upTo = input.upTo;
  if (typeof upTo !== 'number' || !Number.isInteger(upTo) || upTo < 0) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }

  const found = await chatStoreFromRequest(request, typeof input.org === 'string' ? input.org : null);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });

  const identity = await currentChatIdentity(found.store);
  if (identity) await markReadByCustomer(found.store.organizationId, identity, upTo);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
