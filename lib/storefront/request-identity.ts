/*
 * lib/storefront/request-identity.ts
 *
 * Who is making a storefront API request, for rate limiting — the identity
 * the assistant, recommendations and discover limits all key on:
 *
 *   session  the signed-in shopper's session cookie for THIS store, hashed
 *            (the raw token is never a map key); absent for guests
 *   ip       the first x-forwarded-for hop, else x-real-ip — the only
 *            handle on a guest
 *
 * `storeSlug` must be the server-resolved store (./request-store.ts), never a
 * body field: it picks which store's session cookie is read.
 */
import { createHash } from 'node:crypto';
import { sessionCookieName } from '@/lib/storefront/account/session';

export interface RequestIdentity {
  session?: string;
  ip: string;
}

export function requestIdentity(request: Request, storeSlug: string): RequestIdentity {
  const name = `${sessionCookieName(storeSlug)}=`;
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return {
    session: token ? createHash('sha256').update(token).digest('hex').slice(0, 32) : undefined,
    ip,
  };
}
