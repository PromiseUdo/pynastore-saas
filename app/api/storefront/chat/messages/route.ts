/*
 * POST /api/storefront/chat/messages — a shopper sends the store a message
 * (ROADMAP 17.3).
 *
 * Body: { clientId, body, productId?, guestName?, org? }. `clientId` is made
 * by the browser so a retry saves once. The store comes from the request
 * (chatStoreFromRequest); who is writing comes from the session or the guest
 * cookie — and a guest cookie is only ever set here, by a message that is
 * actually going to be saved, never by opening the panel.
 *
 * Sending is rate limited (lib/chat/limits.ts, ROADMAP 17.5) — after the
 * message is checked, so a rejected draft costs nothing, and before the
 * guest cookie, so a refused send leaves nothing behind.
 *
 * JSON only: a cross-site form can't send that without a CORS preflight
 * this route never answers, so another site can't post as a shopper.
 */
import { NextResponse } from 'next/server';
import { runAfter } from '@/lib/run-after';
import { chatStoreFromRequest } from '@/lib/chat/storefront';
import { currentChatIdentity, newGuestIdentity } from '@/lib/chat/identity';
import { chatAvailability, hasShopperConversation, sendCustomerMessage, type SendFailure } from '@/lib/chat/service';
import { isValidClientId, validateMessage } from '@/lib/chat/rules';
import { CHAT_TOO_FAST, checkChatSend } from '@/lib/chat/limits';
import { requestIdentity } from '@/lib/storefront/request-identity';
import { alertStaffAboutMessage } from '@/lib/chat/alerts';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const STATUS: Record<SendFailure, number> = {
  invalid: 400,
  unavailable: 409,
  blocked: 403,
  'not-found': 404,
  failed: 500,
};

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415, headers: NO_STORE });
  }
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    input = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }

  const found = await chatStoreFromRequest(request, typeof input.org === 'string' ? input.org : null);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });
  const { store } = found;

  /* Everything that would refuse the message is checked before a guest
   * cookie can be set, so a refused message leaves nothing behind. The
   * service checks all of it again. */
  const checked = validateMessage(input.body);
  if (!checked.ok) return NextResponse.json({ error: checked.message }, { status: 400, headers: NO_STORE });
  if (!isValidClientId(input.clientId)) {
    return NextResponse.json({ error: 'Your message wasn’t sent. Please try again.' }, { status: 400, headers: NO_STORE });
  }
  if (!(await chatAvailability(store.organizationId)).open) {
    return NextResponse.json({ error: 'This store isn’t taking messages right now.' }, { status: 409, headers: NO_STORE });
  }

  /* A guest's first message: make their key now, so the limits count it
   * against the same sender as everything they send later — but only set the
   * cookie once the message is allowed. */
  const existing = await currentChatIdentity(store);
  const fresh = existing ? null : newGuestIdentity(store.slug);
  const identity = existing ?? fresh!.identity;
  const allowed = await checkChatSend({
    storeSlug: store.slug,
    identity,
    ip: requestIdentity(request, store.slug).ip,
    startsConversation: !existing || !(await hasShopperConversation(store.organizationId, existing)),
  });
  if (!allowed.ok) {
    return NextResponse.json(
      { error: CHAT_TOO_FAST, code: 'too-fast' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(allowed.retryAfterSeconds) } },
    );
  }

  if (fresh) await fresh.remember();
  const result = await sendCustomerMessage(store.organizationId, identity, {
    clientId: input.clientId,
    body: input.body,
    productId: input.productId,
    guestName: input.guestName,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS[result.code], headers: NO_STORE });
  }
  // Email the store if nobody there is watching (ROADMAP 17.4) — after the answer, so it never slows the send.
  const { conversationId } = result;
  runAfter(() => alertStaffAboutMessage(store.organizationId, conversationId));
  return NextResponse.json({ message: result.message }, { headers: NO_STORE });
}
