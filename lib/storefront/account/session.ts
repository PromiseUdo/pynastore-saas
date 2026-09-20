/*
 * lib/storefront/account/session.ts
 *
 * The shopper's session — minted, read and cleared in exactly one place.
 *
 * WHY THIS IS NOT THE ADMIN'S SESSION. auth.config.ts scopes the staff
 * cookie to `.{ROOT_DOMAIN}` on purpose, so one sign-in covers the marketing
 * site, the admin and every subdomain. A shopper cookie must do the opposite:
 * an account belongs to ONE merchant, so signing in at shop.acme.… must mean
 * nothing at shop.zed.… and nothing at all in the admin. Hence a separate
 * cookie, separate secret-derived key, separate claims — and no `Domain`
 * attribute, which leaves the cookie host-scoped to the store's own origin.
 *
 * The cookie NAME still carries the slug. Subdomain and custom-domain stores
 * are already isolated by host, but the Capacitor/mobile origin serves every
 * tenant from ONE host under /s/{slug} (see proxy.ts); without the slug in
 * the name, two stores would fight over a single cookie there. The theme
 * cookie solves the same problem the same way (lib/storefront/theme.ts).
 *
 * Two layers, deliberately separate:
 *   - `signSessionToken` / `verifySessionToken` are pure. Given the secret
 *     they are a self-contained, testable HMAC round trip, and they are what
 *     the tests hold to the tenant rule.
 *   - `getShopper()` adds the database: it re-reads the customer on every
 *     request, so a deactivated account, a changed name or a password reset
 *     takes effect immediately rather than whenever the token happens to
 *     expire. It is memoised per request, so a page that asks three times
 *     queries once.
 */
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { isLocalHostname } from '@/lib/tenant/resolveHostname';

/** Long enough that a returning shopper is still signed in; short enough to matter. */
export const SESSION_TTL_DAYS = 30;

/** What the signed token carries. Nothing here is trusted without the DB re-read below. */
export interface ShopperClaims {
  /** Customer.id */
  customerId: string;
  /** Organization.id — pinned so a token can't be replayed against another store */
  organizationId: string;
  /** Organization.slug — checked against the store serving the request */
  slug: string;
  /** Customer.sessionVersion at sign-in; a reset bumps it and invalidates this token */
  sessionVersion: number;
}

/** The signed-in shopper, as the storefront uses them. */
export interface Shopper {
  id: string;
  organizationId: string;
  email: string;
  /** Full name as the shopper gave it */
  name: string;
  /** For greetings — "Hi Ada", never "Hi Ada Okafor" */
  firstName: string;
  phone: string | null;
  /** false for a Google-only account: the profile page offers to set one */
  hasPassword: boolean;
  emailVerified: boolean;
}

export function sessionCookieName(orgSlug: string): string {
  return `sf-session-${orgSlug}`;
}

/*
 * The signing key. Derived from AUTH_SECRET — the same secret the staff
 * session uses, but a DIFFERENT audience claim, so a staff token can never
 * be presented as a shopper token or the other way round even though one
 * secret protects both.
 */
const AUDIENCE = 'mansaas:storefront-shopper';
const ISSUER = 'mansaas';

/**
 * Shared by the Google-handoff and OAuth-state tokens too — each of which
 * uses its own audience, so a token minted for one purpose can never be
 * accepted for another.
 */
export function accountSigningKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set — the storefront cannot sign shopper sessions');
  }
  return new TextEncoder().encode(secret);
}

const signingKey = accountSigningKey;

export async function signSessionToken(
  claims: ShopperClaims,
  ttlSeconds = SESSION_TTL_DAYS * 24 * 60 * 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    org: claims.organizationId,
    slug: claims.slug,
    sv: claims.sessionVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.customerId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(signingKey());
}

/**
 * Verify a token AND that it belongs to the store asking.
 *
 * `expectedSlug` is not optional and is never taken from the token: the
 * caller passes the slug of the store actually serving the request, and a
 * token minted for another store is rejected here rather than anywhere
 * downstream. This is the check the tenant-isolation test exists for.
 */
export async function verifySessionToken(
  token: string,
  expectedSlug: string,
): Promise<ShopperClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const slug = typeof payload.slug === 'string' ? payload.slug : null;
    const organizationId = typeof payload.org === 'string' ? payload.org : null;
    const customerId = typeof payload.sub === 'string' ? payload.sub : null;
    const sessionVersion = typeof payload.sv === 'number' ? payload.sv : null;

    if (!slug || !organizationId || !customerId || sessionVersion === null) return null;
    if (slug !== expectedSlug) return null;

    return { customerId, organizationId, slug, sessionVersion };
  } catch {
    // Bad signature, wrong audience, expired, malformed — all the same
    // answer: there is no session here.
    return null;
  }
}

/* ---------------- cookie plumbing ---------------- */

async function isSecureRequest(): Promise<boolean> {
  const host = (await headers()).get('host') ?? '';
  return !isLocalHostname(host) && process.env.NODE_ENV === 'production';
}

export async function setSessionCookie(orgSlug: string, token: string): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(orgSlug), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isSecureRequest(),
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    // No `domain`: host-scoped on purpose — see the file header.
  });
}

export async function clearSessionCookie(orgSlug: string): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(orgSlug), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isSecureRequest(),
    path: '/',
    maxAge: 0,
  });
}

/* ---------------- reading the current shopper ---------------- */

/**
 * The slug of the store serving this request, as proxy.ts stamped it.
 * Storefront pages and server actions both carry it; an /api route does not
 * (the proxy's matcher excludes /api), which is why those routes take the
 * slug from the caller instead.
 */
export async function currentStoreSlug(): Promise<string | null> {
  try {
    return (await headers()).get('x-org-slug');
  } catch {
    return null;
  }
}

const loadShopper = cache(async (slug: string, token: string): Promise<Shopper | null> => {
  const claims = await verifySessionToken(token, slug);
  if (!claims) return null;

  const customer = await prisma.customer.findFirst({
    where: {
      id: claims.customerId,
      organizationId: claims.organizationId,
      status: 'ACTIVE',
      organization: { slug, status: 'ACTIVE' },
    },
    select: {
      id: true,
      organizationId: true,
      email: true,
      name: true,
      phone: true,
      passwordHash: true,
      emailVerifiedAt: true,
      sessionVersion: true,
    },
  });

  // A customer deactivated, moved or reset since the token was issued reads
  // as signed out — the token is still validly signed, and that is exactly
  // why the database gets the last word.
  if (!customer?.email) return null;
  if (customer.sessionVersion !== claims.sessionVersion) return null;

  return {
    id: customer.id,
    organizationId: customer.organizationId,
    email: customer.email,
    name: customer.name,
    firstName: customer.name.trim().split(/\s+/)[0] || customer.name,
    phone: customer.phone,
    hasPassword: Boolean(customer.passwordHash),
    emailVerified: Boolean(customer.emailVerifiedAt),
  };
});

/**
 * The signed-in shopper, or null. Safe to call from any storefront server
 * component or server action; never throws, because a storefront that can't
 * read a cookie must still render its catalogue.
 */
export async function getShopper(): Promise<Shopper | null> {
  const slug = await currentStoreSlug();
  if (!slug) return null;

  const token = (await cookies()).get(sessionCookieName(slug))?.value;
  if (!token) return null;

  try {
    return await loadShopper(slug, token);
  } catch {
    return null;
  }
}

/**
 * The signed-in shopper, or a bounce to sign-in that remembers where they
 * were headed.
 *
 * Used by the pages that genuinely need an account — the account area itself
 * — and nowhere else. Browsing, the bag and checkout must keep working
 * without one.
 */
export async function requireShopper(returnTo: string): Promise<Shopper> {
  const shopper = await getShopper();
  if (!shopper) redirect(`/account/sign-in?next=${encodeURIComponent(returnTo)}`);
  return shopper;
}
