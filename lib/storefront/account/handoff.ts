/*
 * lib/storefront/account/handoff.ts
 *
 * The one-minute ticket that carries a finished Google sign-in from the root
 * domain (where Google sent the shopper) to the store's own origin (the only
 * place its session cookie may live). See ./google.ts for why the detour
 * exists at all.
 *
 * A ticket is signed, pinned to one store, valid for sixty seconds, and
 * SINGLE USE — the row is claimed with a conditional update, so two tabs
 * racing the same link produce one session and one failure, not two
 * sessions. It carries no personal data: an id, a store and a customer id.
 *
 * A ticket minted for a phone app (ROADMAP 16.1) travels through a custom
 * URL scheme, which another app on the phone could also claim. So it is also
 * bound to a challenge: it is spent only together with the verifier that
 * hashes to it, which never leaves the app's WebView (RFC 8252's answer to
 * the same problem).
 */
import { createHash, randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { accountSigningKey, type ShopperClaims } from './session';

const AUDIENCE = 'mansaas:storefront-auth-handoff';
const ISSUER = 'mansaas';
const TTL_SECONDS = 60;

export async function mintHandoffToken(
  claims: ShopperClaims,
  options: { challenge?: string } = {},
): Promise<string> {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await prisma.customerAuthHandoff.create({
    data: { id: jti, expiresAt: new Date((now + TTL_SECONDS) * 1000) },
  });

  return new SignJWT({
    org: claims.organizationId,
    slug: claims.slug,
    sv: claims.sessionVersion,
    ...(options.challenge ? { chal: options.challenge } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setSubject(claims.customerId)
    .setIssuedAt(now)
    .setExpirationTime(now + TTL_SECONDS)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(accountSigningKey());
}

/**
 * Verify, claim and spend a ticket. Returns null if it was forged, expired,
 * already used, minted for a different store than the one asking, or minted
 * for an app and presented without the right verifier.
 */
export async function consumeHandoffToken(
  token: string,
  expectedSlug: string,
  verifier?: string | null,
): Promise<ShopperClaims | null> {
  let jti: string;
  let claims: ShopperClaims;

  try {
    const { payload } = await jwtVerify(token, accountSigningKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const slug = typeof payload.slug === 'string' ? payload.slug : null;
    const organizationId = typeof payload.org === 'string' ? payload.org : null;
    const customerId = typeof payload.sub === 'string' ? payload.sub : null;
    const sessionVersion = typeof payload.sv === 'number' ? payload.sv : null;

    if (!payload.jti || !slug || !organizationId || !customerId || sessionVersion === null) return null;
    if (slug !== expectedSlug) return null;

    // An app's ticket is worthless without the verifier its WebView kept.
    if (typeof payload.chal === 'string') {
      if (!verifier || createHash('sha256').update(verifier).digest('base64url') !== payload.chal) return null;
    }

    jti = payload.jti;
    claims = { customerId, organizationId, slug, sessionVersion };
  } catch {
    return null;
  }

  // Claim it. `updateMany` with `usedAt: null` in the filter makes this a
  // compare-and-set: exactly one caller can ever see a count of 1.
  const claimed = await prisma.customerAuthHandoff.updateMany({
    where: { id: jti, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (claimed.count !== 1) return null;

  return claims;
}

/** Housekeeping: spent and expired tickets are worthless after their minute. */
export async function purgeExpiredHandoffs(): Promise<void> {
  await prisma.customerAuthHandoff.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
}
