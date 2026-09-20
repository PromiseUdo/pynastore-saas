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
 */
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { accountSigningKey, type ShopperClaims } from './session';

const AUDIENCE = 'mansaas:storefront-auth-handoff';
const ISSUER = 'mansaas';
const TTL_SECONDS = 60;

export async function mintHandoffToken(claims: ShopperClaims): Promise<string> {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await prisma.customerAuthHandoff.create({
    data: { id: jti, expiresAt: new Date((now + TTL_SECONDS) * 1000) },
  });

  return new SignJWT({
    org: claims.organizationId,
    slug: claims.slug,
    sv: claims.sessionVersion,
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
 * already used, or minted for a different store than the one asking.
 */
export async function consumeHandoffToken(
  token: string,
  expectedSlug: string,
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
