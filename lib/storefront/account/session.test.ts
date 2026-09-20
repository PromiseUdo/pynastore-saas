/*
 * The shopper session token.
 *
 * The test that matters most is the tenant one: a perfectly valid session
 * for one store must be worthless at another. Everything else here — a
 * tampered payload, an expired token, a token minted for a different purpose
 * — is the same rule from a different angle, because a shopper session is
 * the one storefront credential that can spend money.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';
import {
  accountSigningKey,
  sessionCookieName,
  signSessionToken,
  verifySessionToken,
} from './session';

const CLAIMS = {
  customerId: 'cus_ada',
  organizationId: 'org_acme',
  slug: 'acme',
  sessionVersion: 0,
};

beforeAll(() => {
  process.env.AUTH_SECRET ||= 'test-secret-for-storefront-sessions';
});

describe('signSessionToken / verifySessionToken', () => {
  it('round-trips the claims for the store it was minted for', async () => {
    const token = await signSessionToken(CLAIMS);
    await expect(verifySessionToken(token, 'acme')).resolves.toEqual(CLAIMS);
  });

  it('refuses a token minted for another store', async () => {
    const token = await signSessionToken(CLAIMS);
    await expect(verifySessionToken(token, 'zed')).resolves.toBeNull();
  });

  it('refuses a tampered payload', async () => {
    const token = await signSessionToken(CLAIMS);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'cus_someone_else', org: 'org_acme', slug: 'acme', sv: 0 }),
    ).toString('base64url');

    await expect(verifySessionToken(`${header}.${forged}.${signature}`, 'acme')).resolves.toBeNull();
  });

  it('refuses an expired token', async () => {
    const token = await signSessionToken(CLAIMS, -10);
    await expect(verifySessionToken(token, 'acme')).resolves.toBeNull();
  });

  it('refuses a token signed for a different audience', async () => {
    // Same secret, different purpose — e.g. a handoff ticket replayed as a
    // session, which is why every token type in this folder sets its own.
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ org: 'org_acme', slug: 'acme', sv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('cus_ada')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setIssuer('mansaas')
      .setAudience('mansaas:storefront-auth-handoff')
      .sign(accountSigningKey());

    await expect(verifySessionToken(token, 'acme')).resolves.toBeNull();
  });

  it('refuses a token whose session version claim is missing', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ org: 'org_acme', slug: 'acme' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('cus_ada')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setIssuer('mansaas')
      .setAudience('mansaas:storefront-shopper')
      .sign(accountSigningKey());

    await expect(verifySessionToken(token, 'acme')).resolves.toBeNull();
  });
});

describe('sessionCookieName', () => {
  it('names a cookie per store, so the shared mobile origin cannot mix them', () => {
    expect(sessionCookieName('acme')).toBe('sf-session-acme');
    expect(sessionCookieName('zed')).not.toBe(sessionCookieName('acme'));
  });
});
