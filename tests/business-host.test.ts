/*
 * The business host (ROADMAP 19.1): b.{ROOT_DOMAIN} serves the admin for
 * whichever shop the session is in, plus sign-in and onboarding, on one
 * origin. Covers the hostname, the reserved slugs, the proxy's routing
 * decisions, which shop a request is in (against the real database), the
 * `/o/{slug}/…` switch, and the links that must stay on this host.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { pinDomains, ROOT_DOMAIN } from './helpers/storefront-requests';

const state = vi.hoisted(() => ({
  host: 'b.app.localhost:3000' as string | null,
  session: null as null | { user: { id: string }; currentOrgSlug?: string },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.host ? { host: state.host } : {}),
}));
vi.mock('@/lib/auth', () => ({ auth: async () => state.session }));
const switched = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/session', () => ({
  updateCurrentOrganization: vi.fn(async (_userId: string, _orgId: string, slug: string) => {
    switched.push(slug);
  }),
}));

pinDomains();
const BUSINESS = `b.${ROOT_DOMAIN}`;

const { resolveHostname } = await import('@/lib/tenant/resolveHostname');
const { isReservedSlug } = await import('@/lib/tenant/reserved-slugs');
const { getBusinessUrl, getBusinessEntryUrl } = await import('@/lib/tenant/urls');
const { resolveBusinessRoute, safeBusinessPath, businessShopFor, canOpenShop } = await import('@/lib/tenant/business');
const { adminUrlHere, currentShopUrlHere, signInTargetHere, isBusinessRequest } = await import('@/lib/tenant/here');
const { GET: openShop } = await import('@/app/business/open/[organizationSlug]/route');
const { switchOrganization } = await import('@/features/org/actions');

describe('the business hostname', () => {
  it('is b.{ROOT_DOMAIN}, not the admin of a shop called "b"', () => {
    expect(resolveHostname(BUSINESS)).toEqual({ hostname: BUSINESS, siteType: 'business', subdomain: null, isCustomDomain: false });
    expect(resolveHostname(`acme.${ROOT_DOMAIN}`)).toMatchObject({ siteType: 'admin', subdomain: 'acme' });
    expect(resolveHostname(`bb.${ROOT_DOMAIN}`)).toMatchObject({ siteType: 'admin', subdomain: 'bb' });
  });

  it('follows NEXT_PUBLIC_BUSINESS_DOMAIN when set', () => {
    const was = process.env.NEXT_PUBLIC_BUSINESS_DOMAIN;
    process.env.NEXT_PUBLIC_BUSINESS_DOMAIN = 'business.example.com';
    try {
      expect(resolveHostname('business.example.com')).toMatchObject({ siteType: 'business' });
      expect(getBusinessUrl('/orders')).toBe('https://business.example.com/orders');
    } finally {
      if (was === undefined) delete process.env.NEXT_PUBLIC_BUSINESS_DOMAIN;
      else process.env.NEXT_PUBLIC_BUSINESS_DOMAIN = was;
    }
  });

  it('reserves the slugs it uses', () => {
    expect(isReservedSlug('b')).toBe(true);
    expect(isReservedSlug('business')).toBe(true);
    expect(isReservedSlug('bee')).toBe(false);
  });

  it('builds plain and entry links', () => {
    expect(getBusinessUrl('/inventory')).toBe(`http://${BUSINESS}/inventory`);
    expect(getBusinessEntryUrl('acme', '/orders/1')).toBe(`http://${BUSINESS}/o/acme/orders/1`);
    expect(getBusinessEntryUrl('acme')).toBe(`http://${BUSINESS}/o/acme`);
  });
});

describe('routing on the business host', () => {
  const route = (path: string, signedIn: boolean, method = 'GET', search = '') =>
    resolveBusinessRoute(path, { signedIn, method, search });

  it('serves the sign-in pages to anyone', () => {
    for (const path of ['/login', '/register', '/forgot-password', '/reset-password', '/invite/tok', '/verify-email/tok']) {
      expect(route(path, false), path).toEqual({ kind: 'pass' });
    }
  });

  it('sends a signed-in person away from /login and /register, but lets a form post through', () => {
    expect(route('/login', true)).toEqual({ kind: 'home' });
    expect(route('/register', true)).toEqual({ kind: 'home' });
    expect(route('/login', true, 'POST')).toEqual({ kind: 'pass' });
  });

  it('asks a signed-out person to sign in for everything else', () => {
    for (const path of ['/', '/dashboard', '/onboarding', '/o/acme/orders']) {
      expect(route(path, false), path).toEqual({ kind: 'sign-in' });
    }
  });

  it('serves onboarding and the no-access page without a shop', () => {
    expect(route('/onboarding', true)).toEqual({ kind: 'pass' });
    expect(route('/business/no-access', true)).toEqual({ kind: 'pass' });
  });

  it('never serves the console, the storefront or the shopper app', () => {
    for (const path of ['/platform', '/platform/merchants', '/store/acme', '/s/acme', '/m']) {
      expect(route(path, true), path).toEqual({ kind: 'blocked' });
    }
    // …but admin pages that merely start with the same letters are the admin's.
    for (const path of ['/settings', '/stores', '/storefront', '/marketing', '/sales']) {
      expect(route(path, true), path).toEqual({ kind: 'admin' });
    }
  });

  it('reads /o/{slug}/{path} as a switch to that shop', () => {
    expect(route('/o/acme/orders/123', true, 'GET', '?tab=items')).toEqual({ kind: 'entry', slug: 'acme', to: '/orders/123?tab=items' });
    expect(route('/o/acme', true)).toEqual({ kind: 'entry', slug: 'acme', to: '/' });
    expect(route('/o/Not_A_Slug/x', true)).toEqual({ kind: 'blocked' });
    expect(route('/business/open/acme', true)).toEqual({ kind: 'open' });
  });

  it('serves the install files to anyone, from the business tree', () => {
    for (const signedIn of [false, true]) {
      expect(route('/manifest.webmanifest', signedIn)).toEqual({ kind: 'install' });
      expect(route('/app-icon/192', signedIn)).toEqual({ kind: 'install' });
      expect(route('/business/manifest.webmanifest', signedIn)).toEqual({ kind: 'pass' });
      expect(route('/business/app-icon/512', signedIn)).toEqual({ kind: 'pass' });
    }
    expect(route('/business/anything-else', false)).toEqual({ kind: 'sign-in' });
  });

  it('only ever lands on a path on this host', () => {
    expect(safeBusinessPath('/orders?x=1')).toBe('/orders?x=1');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '', null, '/o/acme/x', '/business/open/acme']) {
      expect(safeBusinessPath(bad), String(bad)).toBe('/dashboard');
    }
  });
});

describe('links that stay on this host', () => {
  it('stay on the business host there', async () => {
    state.host = BUSINESS;
    expect(await isBusinessRequest()).toBe(true);
    expect(await adminUrlHere('acme', '/dashboard')).toBe(`http://${BUSINESS}/o/acme/dashboard`);
    expect(await currentShopUrlHere('acme', '/dashboard')).toBe(`http://${BUSINESS}/dashboard`);
    expect(await signInTargetHere('/onboarding')).toBe(`http://${BUSINESS}/onboarding`);
  });

  it('are unchanged everywhere else', async () => {
    state.host = `acme.${ROOT_DOMAIN}`;
    expect(await adminUrlHere('acme', '/dashboard')).toBe(`http://acme.${ROOT_DOMAIN}/dashboard`);
    expect(await currentShopUrlHere('acme', '/dashboard')).toBe(`http://acme.${ROOT_DOMAIN}/dashboard`);
    state.host = ROOT_DOMAIN;
    expect(await signInTargetHere('/onboarding')).toBe('/onboarding');
  });

  it('leave an absolute or protocol-relative target alone', async () => {
    state.host = BUSINESS;
    expect(await signInTargetHere(`http://${BUSINESS}/orders`)).toBe(`http://${BUSINESS}/orders`);
    expect(await signInTargetHere('//evil.example')).toBe('//evil.example');
  });
});

describe('which shop a business-host request is in', () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const slugs = { first: `__test-biz-a-${stamp}`, second: `__test-biz-b-${stamp}`, suspended: `__test-biz-s-${stamp}`, closed: `__test-biz-c-${stamp}`, foreign: `__test-biz-f-${stamp}` };
  let userId = '';
  let loneUserId = '';
  const orgIds: string[] = [];

  async function shop(slug: string, status: 'ACTIVE' | 'SUSPENDED' | 'DELETED', member: boolean, joinedAt: Date) {
    const org = await prisma.organization.create({ data: { name: slug, slug, status } });
    orgIds.push(org.id);
    if (member) {
      const role = await prisma.role.create({ data: { organizationId: org.id, name: 'Owner', isSystem: true } });
      await prisma.membership.create({ data: { userId, organizationId: org.id, roleId: role.id, joinedAt } });
    }
    return org;
  }

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `biz-${stamp}@example.test`, name: 'Biz Test' } })).id;
    loneUserId = (await prisma.user.create({ data: { email: `biz-lone-${stamp}@example.test`, name: 'No Shop' } })).id;
    const t = Date.now();
    await shop(slugs.suspended, 'SUSPENDED', true, new Date(t - 3000));
    await shop(slugs.first, 'ACTIVE', true, new Date(t - 2000));
    await shop(slugs.second, 'ACTIVE', true, new Date(t - 1000));
    await shop(slugs.closed, 'DELETED', true, new Date(t));
    await shop(slugs.foreign, 'ACTIVE', false, new Date(t));
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, loneUserId] } } });
  });

  beforeEach(() => {
    state.host = BUSINESS;
    switched.length = 0;
  });

  it("is the session's shop while they're still in it", async () => {
    expect(await businessShopFor(userId, slugs.second)).toEqual({ slug: slugs.second, status: 'ACTIVE', remembered: true });
    expect(await businessShopFor(userId, slugs.suspended)).toEqual({ slug: slugs.suspended, status: 'SUSPENDED', remembered: true });
  });

  it('falls back to their first open shop when the remembered one is deleted, foreign or unset', async () => {
    for (const remembered of [slugs.closed, slugs.foreign, undefined]) {
      expect(await businessShopFor(userId, remembered), String(remembered)).toEqual({ slug: slugs.first, status: 'ACTIVE', remembered: false });
    }
  });

  it('is none for someone in no shop', async () => {
    expect(await businessShopFor(loneUserId, undefined)).toBeNull();
  });

  it('opens a shop only for its members', async () => {
    expect(await canOpenShop(userId, slugs.second)).toMatchObject({ slug: slugs.second });
    expect(await canOpenShop(userId, slugs.foreign)).toBeNull();
    expect(await canOpenShop(userId, slugs.closed)).toBeNull();
  });

  const open = (slug: string, to: string, host = BUSINESS) =>
    openShop(new Request(`http://${host}/business/open/${slug}?to=${encodeURIComponent(to)}`, { headers: { host } }), {
      params: Promise.resolve({ organizationSlug: slug }),
    });

  it('switches to the shop a link names, then lands on the page', async () => {
    state.session = { user: { id: userId }, currentOrgSlug: slugs.first };
    const res = await open(slugs.second, '/orders/1?tab=items');
    expect(res.headers.get('location')).toBe(`http://${BUSINESS}/orders/1?tab=items`);
    expect(switched).toEqual([slugs.second]);
  });

  it("still records the shop when the session already names it (this host's cookie may not)", async () => {
    state.session = { user: { id: userId }, currentOrgSlug: slugs.second };
    const res = await open(slugs.second, '/dashboard');
    expect(res.headers.get('location')).toBe(`http://${BUSINESS}/dashboard`);
    expect(switched).toEqual([slugs.second]);
  });

  it("never moves the session to a shop they aren't in", async () => {
    state.session = { user: { id: userId }, currentOrgSlug: slugs.first };
    const res = await open(slugs.foreign, '/orders');
    expect(res.headers.get('location')).toBe(`http://${BUSINESS}/business/no-access`);
    expect(switched).toEqual([]);
  });

  it('refuses a landing page off this host', async () => {
    state.session = { user: { id: userId }, currentOrgSlug: slugs.first };
    const res = await open(slugs.second, '//evil.example/steal');
    expect(res.headers.get('location')).toBe(`http://${BUSINESS}/dashboard`);
  });

  it('asks a signed-out visitor to sign in, and comes back to the same link', async () => {
    state.session = null;
    const res = await open(slugs.second, '/orders');
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`http://${BUSINESS}/login`);
    expect(location.searchParams.get('callbackUrl')).toBe(`http://${BUSINESS}/o/${slugs.second}/orders`);
  });

  it('the switcher changes shop without leaving the business host', async () => {
    state.session = { user: { id: userId }, currentOrgSlug: slugs.first };
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: slugs.second }, select: { id: true } });
    expect(await switchOrganization(org.id)).toEqual({ success: true, data: undefined });
    expect(switched).toEqual([slugs.second]);
  });

  it("…and still goes to the other shop's own address everywhere else", async () => {
    state.host = `${slugs.first}.${ROOT_DOMAIN}`;
    state.session = { user: { id: userId }, currentOrgSlug: slugs.first };
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: slugs.second }, select: { id: true } });
    await expect(switchOrganization(org.id)).rejects.toMatchObject({ digest: expect.stringContaining(`http://${slugs.second}.${ROOT_DOMAIN}/dashboard`) });
  });

  it('is a 404 on any other host', async () => {
    state.session = { user: { id: userId }, currentOrgSlug: slugs.first };
    const res = await open(slugs.second, '/orders', `${slugs.second}.${ROOT_DOMAIN}`);
    expect(res.status).toBe(404);
    expect(switched).toEqual([]);
  });
});
