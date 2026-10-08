/*
 * lib/chat/identity.ts
 *
 * Who is chatting on a storefront (ROADMAP 17).
 *
 *   customer  a signed-in shopper of THIS store — their session cookie,
 *             re-read against the database (getShopperForStore)
 *   guest     anyone else who has sent a message: a random key in an
 *             httpOnly cookie named per store, of which only the sha256 is
 *             stored. No Customer row is ever made for a guest.
 *
 * The guest cookie is set on the first SEND, never on opening the panel, so
 * looking at the chat leaves nothing behind. Like the session cookie it is
 * host-scoped (no `domain`), and named per store because the mobile mall
 * serves every store from one hostname.
 *
 * `slug` must be the store the server established — from proxy.ts on a page,
 * from resolveRequestStore on an API route — never a field from a body.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { getShopperForStore, isSecureRequest } from '@/lib/storefront/account/session';

export type ChatIdentity =
  | { kind: 'customer'; customerId: string }
  | { kind: 'guest'; guestKeyHash: string };

/** Long enough that a guest who comes back next month finds their conversation. */
export const GUEST_COOKIE_DAYS = 180;

export function chatGuestCookieName(orgSlug: string): string {
  return `sf-chat-${orgSlug}`;
}

export function hashGuestKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** A key is 32 random bytes, base64url. Anything else in the cookie is ignored. */
function isGuestKey(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function readGuestKey(orgSlug: string): Promise<string | null> {
  const value = (await cookies()).get(chatGuestCookieName(orgSlug))?.value;
  return isGuestKey(value) ? value : null;
}

/**
 * Who this request is, for a store whose id the caller already holds. A
 * signed-in shopper is always their account, even if a guest cookie is also
 * present (./service.ts adopts that guest conversation when it can).
 * Null for someone who has never written.
 */
export async function currentChatIdentity(store: { slug: string; organizationId: string }): Promise<ChatIdentity | null> {
  const shopper = await getShopperForStore(store.slug);
  if (shopper && shopper.organizationId === store.organizationId) {
    return { kind: 'customer', customerId: shopper.id };
  }
  const key = await readGuestKey(store.slug);
  return key ? { kind: 'guest', guestKeyHash: hashGuestKey(key) } : null;
}

/** The guest cookie's hash, if this browser has one — for adopting it on sign-in. */
export async function currentGuestKeyHash(orgSlug: string): Promise<string | null> {
  const key = await readGuestKey(orgSlug);
  return key ? hashGuestKey(key) : null;
}

/**
 * A new guest, not yet remembered by the browser: the identity to check
 * limits against, and `remember()` to set the cookie once the message is
 * allowed. Keeping the two apart means a guest's very first message counts
 * against the same key as all their later ones, and a refused first message
 * leaves no cookie.
 */
export function newGuestIdentity(orgSlug: string): { identity: ChatIdentity; remember: () => Promise<void> } {
  const key = randomBytes(32).toString('base64url');
  return {
    identity: { kind: 'guest', guestKeyHash: hashGuestKey(key) },
    remember: async () => {
      (await cookies()).set(chatGuestCookieName(orgSlug), key, {
        httpOnly: true,
        sameSite: 'lax',
        secure: await isSecureRequest(),
        path: '/',
        maxAge: GUEST_COOKIE_DAYS * 24 * 60 * 60,
      });
    },
  };
}

/**
 * The identity to send as: the signed-in shopper, the guest this browser
 * already is, or a new guest — whose cookie is set here. Call only when a
 * message is actually being sent. Must run where cookies can be written (a
 * route handler or server action).
 */
export async function chatIdentityForSending(store: { slug: string; organizationId: string }): Promise<ChatIdentity> {
  const existing = await currentChatIdentity(store);
  if (existing) return existing;
  const fresh = newGuestIdentity(store.slug);
  await fresh.remember();
  return fresh.identity;
}
