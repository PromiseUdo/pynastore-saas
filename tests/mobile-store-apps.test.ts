/*
 * A store's own phone app (ROADMAP 16.1), against the real database.
 *
 * One deployment serves every app. The app says which one it is in its user
 * agent; the server looks the id up in `MobileApp`, and a store's app must
 * then reach its own store and nothing else — through pages (proxy.ts), the
 * storefront API (request-store.ts), payments and Google sign-in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { deepLinkSchemeFor, isKnownAppId, mobileAppForUserAgent } from '@/lib/mobile/store-apps';
import { resolveRequestStore } from '@/lib/storefront/request-store';
import { GET as googleStart } from '@/app/api/storefront/auth/google/start/route';
import { GET as googleCallback } from '@/app/api/storefront/auth/google/callback/route';
import { createTestStores, mobileRequest, pinDomains } from './helpers/storefront-requests';

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
const A_APP = `com.storea${SUFFIX}.shop`;
const LAPSED_APP = `com.storel${SUFFIX}.shop`;
const ua = (appId: string) => `Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 MansaasApp/${appId}`;

const A = { id: '', slug: '' };
const B = { id: '', slug: '' };
const L = { id: '', slug: '' };
let cleanup = async () => {};

const CHALLENGE = 'c'.repeat(43);
const googleEnv = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

beforeAll(async () => {
  const made = await createTestStores('apps', 3);
  cleanup = made.cleanup;
  Object.assign(A, made.stores[0]);
  Object.assign(B, made.stores[1]);
  Object.assign(L, made.stores[2]);
  await prisma.mobileApp.create({ data: { organizationId: A.id, appId: A_APP, name: 'Store A' } });
  await prisma.mobileApp.create({
    data: { organizationId: L.id, appId: LAPSED_APP, name: 'Store L', status: 'LAPSED' },
  });
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.AUTH_SECRET ||= 'test-secret-for-storefront-sessions';
}, 60_000);

afterAll(async () => {
  for (const [key, value] of [
    ['GOOGLE_CLIENT_ID', googleEnv.id],
    ['GOOGLE_CLIENT_SECRET', googleEnv.secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await cleanup(); // the apps go with their stores (cascade)
}, 60_000);

describe('which app a request comes from', () => {
  it("is the mall for the shared app, or a browser with no marker", async () => {
    await expect(mobileAppForUserAgent(ua('com.mansaas.app'))).resolves.toEqual({ mode: 'mall', lockedSlug: null });
    await expect(mobileAppForUserAgent('Mozilla/5.0 (iPhone)')).resolves.toEqual({ mode: 'mall', lockedSlug: null });
  });

  it("is locked to its store for a registered, active store app", async () => {
    await expect(mobileAppForUserAgent(ua(A_APP))).resolves.toEqual({ mode: 'branded', lockedSlug: A.slug });
  });

  it('is closed for a lapsed app, naming its store, and for a build nobody registered', async () => {
    await expect(mobileAppForUserAgent(ua(LAPSED_APP))).resolves.toEqual({ mode: 'closed', lockedSlug: L.slug });
    await expect(mobileAppForUserAgent(ua(`com.nobody${SUFFIX}.shop`))).resolves.toEqual({
      mode: 'closed',
      lockedSlug: null,
    });
  });
});

describe('deep links go only to known apps', () => {
  it('knows the shared app and active store apps, nothing else', async () => {
    await expect(isKnownAppId('com.mansaas.app')).resolves.toBe(true);
    await expect(isKnownAppId(A_APP)).resolves.toBe(true);
    await expect(isKnownAppId(LAPSED_APP)).resolves.toBe(false);
    await expect(isKnownAppId(`com.nobody${SUFFIX}.shop`)).resolves.toBe(false);
    await expect(isKnownAppId('javascript:alert(1)')).resolves.toBe(false);
  });

  it("sends a payment back to the store's app, and anything unknown to the shared app", async () => {
    await expect(deepLinkSchemeFor(ua(A_APP))).resolves.toBe(A_APP);
    await expect(deepLinkSchemeFor(ua(`com.nobody${SUFFIX}.shop`))).resolves.toBe('com.mansaas.app');
    await expect(deepLinkSchemeFor('Mozilla/5.0')).resolves.toBe('com.mansaas.app');
  });
});

describe("a store's app reaches only its store through the storefront API", () => {
  it('serves its own store, even from the app root', async () => {
    const fromRoot = mobileRequest(null, '/api/storefront/discover', {}, { 'user-agent': ua(A_APP), referer: 'http://m.app.localhost:3000/' });
    await expect(resolveRequestStore(fromRoot)).resolves.toMatchObject({ ok: true, slug: A.slug });
  });

  it("refuses another store's page or claim", async () => {
    const page = mobileRequest(B.slug, '/api/storefront/discover', {}, { 'user-agent': ua(A_APP) });
    await expect(resolveRequestStore(page)).resolves.toMatchObject({ ok: false });
    const claim = mobileRequest(null, '/api/storefront/discover', {}, { 'user-agent': ua(A_APP) });
    await expect(resolveRequestStore(claim, B.slug)).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it('still lets the shared app browse any store', async () => {
    const page = mobileRequest(B.slug, '/api/storefront/discover', {}, { 'user-agent': ua('com.mansaas.app') });
    await expect(resolveRequestStore(page)).resolves.toMatchObject({ ok: true, slug: B.slug });
  });
});

describe('Google sign-in from inside an app', () => {
  const startUrl = (params: Record<string, string>) => {
    const url = new URL('http://localhost:3000/api/storefront/auth/google/start');
    url.searchParams.set('slug', A.slug);
    url.searchParams.set('next', '/account');
    url.searchParams.set('returnTo', `http://m.app.localhost:3000/s/${A.slug}/account`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new Request(url, { headers: { host: 'localhost:3000' } });
  };

  it('goes to Google for a known app with a challenge', async () => {
    const res = await googleStart(startUrl({ app: A_APP, challenge: CHALLENGE }));
    expect(new URL(res.headers.get('location')!).host).toBe('accounts.google.com');
  });

  it('refuses an app nobody registered, or a missing challenge', async () => {
    const attempts: Record<string, string>[] = [{ app: `com.nobody${SUFFIX}.shop`, challenge: CHALLENGE }, { app: A_APP }];
    for (const params of attempts) {
      const res = await googleStart(startUrl(params));
      expect(res.headers.get('location')).toContain('/account/sign-in?error=google');
    }
  });

  it('hands a cancelled sign-in back to that app by deep link, not to the website', async () => {
    const started = await googleStart(startUrl({ app: A_APP, challenge: CHALLENGE }));
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const nonce = started.headers.get('set-cookie')!.match(/sf-oauth-state=([^;]+)/)![1];

    const res = await googleCallback(
      new Request(
        `http://localhost:3000/api/storefront/auth/google/callback?state=${encodeURIComponent(state)}&error=access_denied`,
        { headers: { host: 'localhost:3000', cookie: `sf-oauth-state=${nonce}` } },
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`${A_APP}://auth-return`);
  });
});
