/*
 * lib/business-app/tickets.ts
 *
 * One-minute, single-use tickets for the business app (ROADMAP 19.2). The
 * app's WebView and its in-app browser sheet keep separate cookies, so
 * anything that must cross between them travels as one of these:
 *
 *   - "sign-in": a Google or Apple sign-in finished in the sheet, carried
 *     to the WebView. It crosses a deep link (`com.mansaas.business://…`),
 *     which another app on the phone could also claim, so it is bound to a
 *     challenge and spent only with the verifier that hashes to it — which
 *     never leaves the WebView (RFC 8252; the shopper apps do the same,
 *     lib/storefront/account/handoff.ts).
 *   - "social-connect": a signed-in member's "connect Facebook", carried
 *     the other way, into the sheet, which has no session of its own.
 *
 * A ticket is a signed token naming its purpose; the row makes it spendable
 * once (claimed with a compare-and-set). It carries ids only.
 */
import { createHash, randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';

export type AppTicketPurpose = 'sign-in' | 'social-connect';
export type AppTicketClaims = Record<string, string | number>;

const ISSUER = 'mansaas';
const AUDIENCE = 'mansaas:business-app-ticket';
const TTL_SECONDS = 60;

function signingKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error('AUTH_SECRET is not set');
  // Its own derivation, so a ticket can never pass for any other token signed with the secret.
  return createHash('sha256').update(`${AUDIENCE}:${secret}`).digest();
}

/** The base64url SHA-256 of a verifier — what an app sends as its challenge. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** 43 base64url characters: a SHA-256, and nothing else. */
export function isValidChallenge(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function mintAppTicket(
  purpose: AppTicketPurpose,
  claims: AppTicketClaims,
  options: { challenge?: string } = {},
): Promise<string> {
  if (purpose === 'sign-in' && !isValidChallenge(options.challenge)) {
    throw new Error('A sign-in ticket must be bound to a challenge');
  }
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await prisma.staffAppTicket.create({ data: { id: jti, purpose, expiresAt: new Date((now + TTL_SECONDS) * 1000) } });

  return new SignJWT({ purpose, claims, ...(options.challenge ? { chal: options.challenge } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + TTL_SECONDS)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(signingKey());
}

/**
 * Verify, claim and spend a ticket. Null if it was forged, expired, already
 * spent, minted for another purpose, or bound to a challenge and presented
 * without the right verifier.
 */
export async function consumeAppTicket(
  purpose: AppTicketPurpose,
  token: string | null | undefined,
  options: { verifier?: string | null } = {},
): Promise<AppTicketClaims | null> {
  if (!token) return null;
  let jti: string;
  let claims: AppTicketClaims;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.jti || payload.purpose !== purpose || typeof payload.claims !== 'object' || !payload.claims) return null;
    if (purpose === 'sign-in' && typeof payload.chal !== 'string') return null;
    if (typeof payload.chal === 'string') {
      if (!options.verifier || challengeFor(options.verifier) !== payload.chal) return null;
    }
    jti = payload.jti;
    claims = payload.claims as AppTicketClaims;
  } catch {
    return null;
  }

  // Exactly one caller can ever see a count of 1.
  const claimed = await prisma.staffAppTicket.updateMany({
    where: { id: jti, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? claims : null;
}

/** Housekeeping: a ticket is worthless an hour after its minute. */
export async function purgeExpiredAppTickets(): Promise<void> {
  await prisma.staffAppTicket.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } });
}
