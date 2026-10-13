/*
 * The business app's trips through its in-app browser sheet (ROADMAP 19.2):
 * the one-minute tickets, staff Google/Apple sign-in (start → finish →
 * handoff), "connect Facebook" from the app, the links the app opens in the
 * sheet, and account emails that come back to the business host.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomBytes } from 'crypto';
import { importSPKI, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { pinDomains, ROOT_DOMAIN } from './helpers/storefront-requests';

const state = vi.hoisted(() => ({
  host: 'b.app.localhost:3000',
  jar: new Map<string, string>(),
  session: null as null | { user: { id: string } },
  signInResult: 'https://accounts.google.com/o/oauth2/auth?x=1' as string | Error,
  signInCalls: [] as { provider: string; options: Record<string, unknown> }[],
  signedOut: 0,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: state.host }),
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
  }),
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => state.session,
  signIn: async (provider: string, options: Record<string, unknown>) => {
    state.signInCalls.push({ provider, options });
    if (state.signInResult instanceof Error) throw state.signInResult;
    return state.signInResult;
  },
  signOut: async () => {
    state.signedOut += 1;
  },
}));
const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Biz', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', warehouseIds: [] as string[], role: { id: 'r', name: 'Owner', isSystem: true, permissions: ['social.manage'] } },
  userId: '',
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));
vi.mock('@/lib/social/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social/service')>()),
  createConnectionDraft: vi.fn(async () => 'draft-1'),
}));
vi.mock('@/lib/ops/webhooks', () => ({ webhookFailed: vi.fn(async () => {}), webhookSucceeded: vi.fn(async () => {}) }));

pinDomains();
const BUSINESS = `b.${ROOT_DOMAIN}`;

const { mintAppTicket, consumeAppTicket, challengeFor, purgeExpiredAppTickets } = await import('@/lib/business-app/tickets');
const { userForAppTicket } = await import('@/lib/business-app/handoff-user');
const { SIGN_IN_COOKIE, sealSignInState } = await import('@/lib/business-app/sign-in-cookie');
const { GET: start } = await import('@/app/api/business/auth/start/route');
const { GET: finish } = await import('@/app/api/business/auth/finish/route');
const { GET: handoff } = await import('@/app/api/business/auth/handoff/route');
const { startSocialConnect } = await import('@/features/social/actions');
const { GET: socialAppStart } = await import('@/app/api/social/meta/app-start/route');
const { GET: socialCallback } = await import('@/app/api/social/meta/callback/route');
const { metaProvider } = await import('@/lib/social/providers/meta');
const { STATE_COOKIE, decodeState } = await import('@/lib/social/state');
const { externalLinkTarget, sameOriginTarget } = await import('@/lib/business-app/client');
const { nextLocationAfterAuthReturn } = await import('@/lib/storefront/account/native-google');
const { accountUrlHere } = await import('@/lib/tenant/here');
const { appleClientSecret, appleSignInConfigured } = await import('@/lib/apple-sign-in');
const { AuthError } = await import('@auth/core/errors');

const verifier = () => randomBytes(32).toString('base64url');
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let userId = '';
let orgId = '';
const slug = `__test-bizapp-${stamp}`;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `bizapp-${stamp}@example.test`, name: 'App Owner' } });
  userId = user.id;
  const org = await prisma.organization.create({ data: { name: 'Biz App', slug } });
  orgId = org.id;
  const role = await prisma.role.create({ data: { organizationId: org.id, name: 'Owner', isSystem: true } });
  await prisma.membership.create({ data: { userId, organizationId: org.id, roleId: role.id } });
  ctx.organization.id = org.id;
  ctx.organization.slug = slug;
  ctx.userId = userId;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

beforeEach(() => {
  state.host = BUSINESS;
  state.jar = new Map();
  state.session = null;
  state.signInCalls = [];
  state.signedOut = 0;
  state.signInResult = 'https://accounts.google.com/o/oauth2/auth?x=1';
});

describe('one-minute tickets', () => {
  it('a sign-in ticket is spent once, and only with the verifier', async () => {
    const v = verifier();
    const ticket = await mintAppTicket('sign-in', { userId: 'u1', sessionVersion: 0 }, { challenge: challengeFor(v) });
    expect(await consumeAppTicket('sign-in', ticket, { verifier: verifier() })).toBeNull();
    expect(await consumeAppTicket('sign-in', ticket)).toBeNull();
    expect(await consumeAppTicket('sign-in', ticket, { verifier: v })).toEqual({ userId: 'u1', sessionVersion: 0 });
    expect(await consumeAppTicket('sign-in', ticket, { verifier: v })).toBeNull();
  });

  it('is refused for another purpose, forged, or expired', async () => {
    const connect = await mintAppTicket('social-connect', { userId: 'u1' });
    expect(await consumeAppTicket('sign-in', connect, { verifier: verifier() })).toBeNull();
    expect(await consumeAppTicket('social-connect', `${connect}x`)).toBeNull();

    const late = await mintAppTicket('social-connect', { userId: 'u1' });
    const { jti } = JSON.parse(Buffer.from(late.split('.')[1], 'base64url').toString());
    await prisma.staffAppTicket.update({ where: { id: jti }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumeAppTicket('social-connect', late)).toBeNull();
  });

  it('a sign-in ticket must be bound to a challenge', async () => {
    await expect(mintAppTicket('sign-in', { userId: 'u1' })).rejects.toThrow(/challenge/);
  });

  it('spent tickets are cleared an hour after they expire', async () => {
    const old = await prisma.staffAppTicket.create({ data: { id: `old-${stamp}`, purpose: 'sign-in', expiresAt: new Date(Date.now() - 2 * 3600_000) } });
    await purgeExpiredAppTickets();
    expect(await prisma.staffAppTicket.findUnique({ where: { id: old.id } })).toBeNull();
  });

  it('signs in the ticket’s person — unless their password was reset since', async () => {
    const v = verifier();
    const ticket = await mintAppTicket('sign-in', { userId, sessionVersion: 0 }, { challenge: challengeFor(v) });
    expect(await userForAppTicket(ticket, v)).toMatchObject({ id: userId });

    const stale = await mintAppTicket('sign-in', { userId, sessionVersion: 0 }, { challenge: challengeFor(v) });
    await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    try {
      expect(await userForAppTicket(stale, v)).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { sessionVersion: 0 } });
    }
  });
});

describe('signing in from the business app', () => {
  const startRequest = (query: string, host = ROOT_DOMAIN) =>
    start(new Request(`http://${host}/api/business/auth/start?${query}`, { headers: { host } }));

  it('start: remembers the challenge and where to land, then hands over to the provider', async () => {
    state.host = ROOT_DOMAIN;
    const v = verifier();
    const res = await startRequest(`provider=google&challenge=${challengeFor(v)}&next=${encodeURIComponent('/invite/abc?auto=1')}`);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://accounts.google.com/o/oauth2/auth?x=1');
    expect(state.signInCalls).toEqual([{ provider: 'google', options: { redirectTo: `http://${ROOT_DOMAIN}/api/business/auth/finish`, redirect: false } }]);
    expect(res.headers.get('set-cookie')).toContain(`${SIGN_IN_COOKIE}=`);
  });

  it('start: only on the platform host, and only with a real challenge and a known provider', async () => {
    const elsewhere = await startRequest(`provider=google&challenge=${challengeFor(verifier())}`, BUSINESS);
    expect(elsewhere.headers.get('location')).toMatch(new RegExp(`^http://${ROOT_DOMAIN.replace('.', '\\.')}/api/business/auth/start\\?`));
    expect((await startRequest('provider=google&challenge=short')).status).toBe(400);
    expect((await startRequest(`provider=github&challenge=${challengeFor(verifier())}`)).status).toBe(400);
    // Apple is off until configured.
    expect(appleSignInConfigured()).toBe(false);
    expect((await startRequest(`provider=apple&challenge=${challengeFor(verifier())}`)).status).toBe(404);
    expect(state.signInCalls).toEqual([]);
  });

  it('finish: turns the sheet’s sign-in into a ticket for the app, and signs the sheet out', async () => {
    const v = verifier();
    state.host = ROOT_DOMAIN;
    state.session = { user: { id: userId } };
    state.jar.set(SIGN_IN_COOKIE, await sealSignInState({ challenge: challengeFor(v), next: '/onboarding' }));

    const res = await finish();
    const html = await res.text();
    const deepLink = html.match(/window\.location\.href = "([^"]+)"/)![1].replace(/\\u0026/g, '&');
    expect(deepLink.startsWith('com.mansaas.business://auth-return?to=')).toBe(true);

    const to = new URL(new URLSearchParams(deepLink.split('?')[1]).get('to')!);
    expect(`${to.origin}${to.pathname}`).toBe(`http://${BUSINESS}/api/business/auth/handoff`);
    expect(to.searchParams.get('next')).toBe('/onboarding');
    expect(await userForAppTicket(to.searchParams.get('token'), v)).toMatchObject({ id: userId });
    expect(state.signedOut).toBe(1);
  });

  it('finish: without the sheet’s state or a sign-in, the app is told it failed', async () => {
    state.session = { user: { id: userId } };
    const noState = await (await finish()).text();
    expect(noState).toContain('com.mansaas.business://auth-return?error=sign-in');

    state.session = null;
    state.jar.set(SIGN_IN_COOKIE, await sealSignInState({ challenge: challengeFor(verifier()), next: '/' }));
    expect(await (await finish()).text()).toContain('auth-return?error=sign-in');
    // The sheet that WAS signed in is signed out even so; the one that wasn't needs nothing.
    expect(state.signedOut).toBe(1);
  });

  const handoffRequest = (query: string, host = BUSINESS) =>
    handoff(new Request(`http://${host}/api/business/auth/handoff?${query}`, { headers: { host } }));

  it('handoff: spends the ticket on the business host and lands on the page asked for', async () => {
    state.signInResult = `http://${BUSINESS}/invite/abc?auto=1`;
    const res = await handoffRequest(`token=t&verifier=v&next=${encodeURIComponent('/invite/abc?auto=1')}`);
    expect(res.headers.get('location')).toBe(`http://${BUSINESS}/invite/abc?auto=1`);
    expect(state.signInCalls[0]).toEqual({
      provider: 'app-handoff',
      options: { token: 't', verifier: 'v', redirectTo: `http://${BUSINESS}/invite/abc?auto=1`, redirect: false },
    });
  });

  it('handoff: a refused ticket goes back to sign-in, saying so; off-site landings and other hosts are refused', async () => {
    state.signInResult = new AuthError('CredentialsSignin');
    expect((await handoffRequest('token=t&verifier=v')).headers.get('location')).toBe(`http://${BUSINESS}/login?error=app-sign-in`);

    state.signInResult = `http://${BUSINESS}/dashboard`;
    await handoffRequest(`token=t&verifier=v&next=${encodeURIComponent('//evil.example')}`);
    expect(state.signInCalls.at(-1)!.options.redirectTo).toBe(`http://${BUSINESS}/dashboard`);

    expect((await handoffRequest('token=t&verifier=v', `${slug}.${ROOT_DOMAIN}`)).status).toBe(404);
  });

  it('the app follows only a handoff link on its own host', () => {
    const current = `http://${BUSINESS}/login`;
    const link = (to: string) => `com.mansaas.business://auth-return?to=${encodeURIComponent(to)}`;
    const path = '/api/business/auth/handoff';
    expect(nextLocationAfterAuthReturn(link(`http://${BUSINESS}${path}?token=t`), 'v1', current, path)).toBe(`http://${BUSINESS}${path}?token=t&verifier=v1`);
    expect(nextLocationAfterAuthReturn(link(`https://evil.example${path}?token=t`), 'v1', current, path)).toBeNull();
    expect(nextLocationAfterAuthReturn(link(`http://${BUSINESS}/api/storefront/auth/handoff?token=t`), 'v1', current, path)).toBeNull();
  });
});

describe('Sign in with Apple', () => {
  it('signs its client secret with the platform’s key, for Apple', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const settings = {
      AUTH_APPLE_ID: 'com.mansaas.signin',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_SIGN_IN_KEY_ID: 'KEY1234567',
      // As pasted into an env var: one line, with escaped line breaks.
      APPLE_SIGN_IN_PRIVATE_KEY: (privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).replace(/\n/g, '\\n'),
    };
    const was = Object.fromEntries(Object.keys(settings).map((k) => [k, process.env[k]]));
    Object.assign(process.env, settings);
    try {
      expect(appleSignInConfigured()).toBe(true);
      const secret = appleClientSecret()!;
      const key = await importSPKI(publicKey.export({ type: 'spki', format: 'pem' }) as string, 'ES256');
      const { payload, protectedHeader } = await jwtVerify(secret, key, { audience: 'https://appleid.apple.com', issuer: 'TEAM123456' });
      expect(protectedHeader).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
      expect(payload.sub).toBe('com.mansaas.signin');
      expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(180 * 24 * 3600);
    } finally {
      for (const [k, v] of Object.entries(was)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('connecting Facebook from the business app', () => {
  it('the app gets a one-minute link into the sheet instead of Meta’s address', async () => {
    const result = await startSocialConnect('meta', { inApp: true });
    expect(result.success).toBe(true);
    const url = new URL((result as { data: { url: string } }).data.url);
    expect(`${url.origin}${url.pathname}`).toBe(`http://${ROOT_DOMAIN}/api/social/meta/app-start`);
    expect(state.jar.size).toBe(0); // no nonce in the WebView: it belongs to the sheet
  });

  it('on the business host, the web flow comes back through /o/{slug}/social', async () => {
    const result = await startSocialConnect('meta');
    const url = new URL((result as { data: { url: string } }).data.url);
    const decoded = decodeState(url.searchParams.get('state'), state.jar.get(STATE_COOKIE));
    expect(decoded.returnTo).toBe(`http://${BUSINESS}/o/${slug}/social`);
    expect(decoded.app).toBeUndefined();
  });

  async function appStart() {
    const result = await startSocialConnect('meta', { inApp: true });
    const res = await socialAppStart(new Request((result as { data: { url: string } }).data.url));
    return { res, url: (result as { data: { url: string } }).data.url };
  }

  it('app-start: spends the ticket once, arms the nonce in the sheet and goes to Meta', async () => {
    const { res, url } = await appStart();
    const meta = new URL(res.headers.get('location')!);
    expect(meta.hostname).toBe('www.facebook.com');
    const nonce = res.headers.get('set-cookie')!.match(new RegExp(`${STATE_COOKIE.replace('.', '\\.')}=([^;]+)`))![1];
    expect(decodeState(meta.searchParams.get('state'), nonce)).toMatchObject({ organizationId: orgId, userId, app: true });

    const again = await socialAppStart(new Request(url));
    expect(again.status).toBe(400);
  });

  it('the callback finishes without a session in the sheet, and hands the next page back to the app', async () => {
    const { res } = await appStart();
    const meta = new URL(res.headers.get('location')!);
    const nonce = res.headers.get('set-cookie')!.match(new RegExp(`${STATE_COOKIE.replace('.', '\\.')}=([^;]+)`))![1];
    const exchange = vi.spyOn(metaProvider, 'exchangeCode').mockResolvedValue({ accounts: [{ id: 'p1' }] } as never);
    try {
      const { NextRequest } = await import('next/server');
      const request = new NextRequest(`http://${ROOT_DOMAIN}/api/social/meta/callback?code=c1&state=${encodeURIComponent(meta.searchParams.get('state')!)}`, {
        headers: { cookie: `${STATE_COOKIE}=${nonce}` },
      });
      const html = await (await socialCallback(request)).text();
      const deepLink = html.match(/window\.location\.href = "([^"]+)"/)![1].replace(/\\u0026/g, '&');
      expect(deepLink.startsWith('com.mansaas.business://social-return?to=')).toBe(true);
      const to = new URL(new URLSearchParams(deepLink.split('?')[1]).get('to')!);
      expect(`${to.origin}${to.pathname}`).toBe(`http://${BUSINESS}/o/${slug}/social/connect`);
      expect(to.searchParams.get('draft')).toBe('draft-1');
    } finally {
      exchange.mockRestore();
    }
  });

  it('the callback still refuses a member who lost the permission meanwhile', async () => {
    const { res } = await appStart();
    const meta = new URL(res.headers.get('location')!);
    const nonce = res.headers.get('set-cookie')!.match(new RegExp(`${STATE_COOKIE.replace('.', '\\.')}=([^;]+)`))![1];
    await prisma.membership.updateMany({ where: { userId, organizationId: orgId }, data: { status: 'SUSPENDED' } });
    try {
      const { NextRequest } = await import('next/server');
      const request = new NextRequest(`http://${ROOT_DOMAIN}/api/social/meta/callback?code=c1&state=${encodeURIComponent(meta.searchParams.get('state')!)}`, {
        headers: { cookie: `${STATE_COOKIE}=${nonce}` },
      });
      expect(await (await socialCallback(request)).text()).toContain('social_error%3Dforbidden');
    } finally {
      await prisma.membership.updateMany({ where: { userId, organizationId: orgId }, data: { status: 'ACTIVE' } });
    }
  });
});

describe('links the app opens', () => {
  const here = `http://${BUSINESS}/inventory`;

  it('leaving the host opens the sheet; a new tab of our own opens in the app', () => {
    expect(externalLinkTarget('https://shop-acme.getnotely.io/', '', here)).toEqual({ open: 'sheet', url: 'https://shop-acme.getnotely.io/' });
    expect(externalLinkTarget('/sales/receipt/1', '_blank', here)).toEqual({ open: 'here', url: `http://${BUSINESS}/sales/receipt/1` });
    expect(externalLinkTarget('/orders', '', here)).toBeNull();
    expect(externalLinkTarget('mailto:a@b.c', '', here)).toBeNull();
    expect(externalLinkTarget('tel:+234', '_blank', here)).toBeNull();
  });

  it('a page handed back by deep link must be on this host', () => {
    expect(sameOriginTarget(`http://${BUSINESS}/social/connect?draft=1`, here)).toBe(`http://${BUSINESS}/social/connect?draft=1`);
    expect(sameOriginTarget('https://evil.example/', here)).toBeNull();
    expect(sameOriginTarget(null, here)).toBeNull();
  });
});

describe('account emails', () => {
  it('come back to the business host when that is where the person is', async () => {
    expect(await accountUrlHere('/verify-email/abc')).toBe(`http://${BUSINESS}/verify-email/abc`);
    state.host = ROOT_DOMAIN;
    expect(await accountUrlHere('/reset-password?token=x')).toBe(`http://${ROOT_DOMAIN}/reset-password?token=x`);
  });
});

// Keep the hashing the app does in step with the server's.
it('a challenge is the base64url SHA-256 of the verifier', () => {
  const v = verifier();
  expect(challengeFor(v)).toBe(createHash('sha256').update(v).digest('base64url'));
});
