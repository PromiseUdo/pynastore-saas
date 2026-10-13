/*
 * Notifications in a browser (ROADMAP 18.3), against the real database,
 * with the browsers' push services stubbed.
 *
 *   - only a real push service's subscription is kept — never an arbitrary
 *     address our server would then call;
 *   - each route saves the browser against whoever the session says, only
 *     from a page on the same host, and removes only that person's;
 *   - a guest's browser that asked about an order is told when it changes,
 *     opening the order's page on the shop's own site;
 *   - the install files load for each surface.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  }
  return { WebPushError, sendNotification: vi.fn(async (..._args: unknown[]) => ({ statusCode: 201 })) };
});
vi.mock('web-push', () => ({ default: { sendNotification: push.sendNotification }, WebPushError: push.WebPushError }));
vi.mock('@/lib/email', async (original) => ({
  ...(await original<typeof import('@/lib/email')>()),
  sendStorefrontOrderUpdateEmail: vi.fn(async () => true),
}));

const session = vi.hoisted(() => ({ organizationId: '', userId: '', platformUserId: null as string | null, shopper: null as string | null }));
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: async () => ({ organization: { id: session.organizationId, name: 'Shop' }, userId: session.userId }),
}));
vi.mock('@/lib/platform-staff', () => ({
  getPlatformStaff: async () => (session.platformUserId ? { userId: session.platformUserId, name: 'Staff', email: 's@example.com' } : null),
}));
vi.mock('@/lib/chat/identity', async (original) => ({
  ...(await original<typeof import('@/lib/chat/identity')>()),
  currentChatIdentity: async () => (session.shopper ? { kind: 'customer', customerId: session.shopper } : null),
}));

import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains, storefrontHost } from './helpers/storefront-requests';
import { deviceLabel, parseSubscription } from '@/lib/notifications/web-push-subscriptions';
import { notifyShopper } from '@/lib/storefront/orders/notifications';
import { POST as adminSubscribe, DELETE as adminUnsubscribe } from '@/app/(dashboard)/[organizationSlug]/notifications/web-push/route';
import { POST as platformSubscribe } from '@/app/platform/notifications/web-push/route';
import { POST as shopSubscribe } from '@/app/api/storefront/notifications/web-push/route';
import { GET as adminManifest } from '@/app/(dashboard)/[organizationSlug]/manifest.webmanifest/route';
import { GET as storeManifest } from '@/app/store/[organizationSlug]/manifest.webmanifest/route';

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
const KEYS = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
const sub = (id: string, host = 'fcm.googleapis.com') => ({ endpoint: `https://${host}/fcm/send/${SUFFIX}-${id}`, keys: KEYS });

let shop = { id: '', slug: '' };
let cleanup = async () => {};
const users: string[] = [];
let memberA = '';
let memberB = '';
const savedEnv = { ...process.env };

const ADMIN_HOST = () => `${shop.slug}.app.localhost:3000`;

function adminRequest(method: 'POST' | 'DELETE', body: unknown, headers: Record<string, string> = {}) {
  const host = ADMIN_HOST();
  return new Request(`http://${host}/notifications/web-push`, {
    method,
    headers: { host, origin: `http://${host}`, 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 15) Chrome/129 Mobile', ...headers },
    body: JSON.stringify(body),
  });
}

function shopRequest(body: unknown) {
  const host = storefrontHost(shop.slug);
  return new Request(`http://${host}/api/storefront/notifications/web-push`, {
    method: 'POST',
    headers: { host, origin: `http://${host}`, referer: `http://${host}/`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const made = await createTestStores('__test-webpush', 1);
  cleanup = made.cleanup;
  [shop] = made.stores;
  await prisma.organization.update({ where: { id: shop.id }, data: { storefrontOpen: true } });
  for (const name of ['a', 'b']) {
    const user = await prisma.user.create({ data: { email: `webpush-${name}-${SUFFIX}@example.com` } });
    users.push(user.id);
  }
  [memberA, memberB] = users;
  const staff = await prisma.user.create({ data: { email: `webpush-platform-${SUFFIX}@example.com`, isPlatformStaff: true } });
  users.push(staff.id);
  process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY = 'BPublicKeyForTests';
  process.env.WEB_PUSH_PRIVATE_KEY = 'private-key-for-tests';
  process.env.WEB_PUSH_SUBJECT = 'mailto:ops@example.com';
}, 60_000);

beforeEach(async () => {
  push.sendNotification.mockClear();
  session.organizationId = shop.id;
  session.userId = memberA;
  session.platformUserId = null;
  session.shopper = null;
  await prisma.webPushSubscription.deleteMany({ where: { OR: [{ organizationId: shop.id }, { userId: { in: users } }] } });
});

afterAll(async () => {
  process.env = savedEnv;
  await prisma.webPushSubscription.deleteMany({ where: { OR: [{ organizationId: shop.id }, { userId: { in: users } }] } });
  await prisma.notificationEvent.deleteMany({ where: { organizationId: shop.id } });
  await prisma.order.deleteMany({ where: { organizationId: shop.id } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await cleanup();
}, 60_000);

describe('what a subscription may be', () => {
  it('keeps real push services and refuses any other address', () => {
    for (const host of ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com']) {
      expect(parseSubscription(sub('x', host)), host).not.toBeNull();
    }
    for (const endpoint of [
      'https://evil.example/fcm/send/x',
      'https://fcm.googleapis.com.evil.example/x',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://169.254.169.254/latest',
    ]) {
      expect(parseSubscription({ endpoint, keys: KEYS }), endpoint).toBeNull();
    }
    expect(parseSubscription({ endpoint: sub('x').endpoint, keys: { p256dh: 'short', auth: KEYS.auth } })).toBeNull();
    expect(parseSubscription({ endpoint: sub('x').endpoint, keys: { p256dh: KEYS.p256dh, auth: 'has spaces in it!!' } })).toBeNull();
  });

  it('names a device the way a person would', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129 Safari/537.36 Edg/129')).toBe('Edge on Windows');
    expect(deviceLabel(null)).toBe('A browser');
  });
});

describe('the admin route', () => {
  it('saves this browser for the member in this shop', async () => {
    const response = await adminSubscribe(adminRequest('POST', { subscription: sub('a') }));
    expect(response.status).toBe(200);
    const saved = await prisma.webPushSubscription.findUniqueOrThrow({ where: { endpoint: sub('a').endpoint } });
    expect(saved).toMatchObject({ audience: 'STAFF', userId: memberA, organizationId: shop.id, origin: `http://${ADMIN_HOST()}`, label: 'Chrome on Android' });
  });

  it('refuses another site, a made-up subscription, and anything but JSON', async () => {
    expect((await adminSubscribe(adminRequest('POST', { subscription: sub('b') }, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await adminSubscribe(adminRequest('POST', { subscription: { endpoint: 'https://evil.example/x', keys: KEYS } }))).status).toBe(400);
    expect((await adminSubscribe(adminRequest('POST', { subscription: sub('b') }, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect(await prisma.webPushSubscription.count({ where: { organizationId: shop.id } })).toBe(0);
  });

  it('says so when the platform has no browser keys', async () => {
    delete process.env.WEB_PUSH_PRIVATE_KEY;
    try {
      expect((await adminSubscribe(adminRequest('POST', { subscription: sub('c') }))).status).toBe(503);
    } finally {
      process.env.WEB_PUSH_PRIVATE_KEY = 'private-key-for-tests';
    }
  });

  it('moves a browser to whoever signs in on it, and removes only your own', async () => {
    await adminSubscribe(adminRequest('POST', { subscription: sub('d') }));
    session.userId = memberB;
    await adminSubscribe(adminRequest('POST', { subscription: sub('d') }));
    const moved = await prisma.webPushSubscription.findUniqueOrThrow({ where: { endpoint: sub('d').endpoint } });
    expect(moved.userId).toBe(memberB);

    // Member A can't remove it now, by endpoint or by id.
    session.userId = memberA;
    expect(await (await adminUnsubscribe(adminRequest('DELETE', { id: moved.id }))).json()).toEqual({ ok: false });
    session.userId = memberB;
    expect(await (await adminUnsubscribe(adminRequest('DELETE', { endpoint: sub('d').endpoint }))).json()).toEqual({ ok: true });
  });
});

describe('the console and the storefront', () => {
  it('hides the console’s route from anyone who isn’t platform staff', async () => {
    const host = 'app.localhost:3000';
    const request = () =>
      new Request(`http://${host}/platform/notifications/web-push`, {
        method: 'POST',
        headers: { host, origin: `http://${host}`, 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub('p') }),
      });
    expect((await platformSubscribe(request())).status).toBe(404);
    session.platformUserId = users[2];
    expect((await platformSubscribe(request())).status).toBe(200);
  });

  it('refuses a guest with nothing to hear about, and an order from somewhere else', async () => {
    expect((await shopSubscribe(shopRequest({ subscription: sub('g1') }))).status).toBe(404);
    expect((await shopSubscribe(shopRequest({ subscription: sub('g1'), order: 'not-a-real-token' }))).status).toBe(404);
  });

  it('tells a guest’s browser about their order, opening it on the shop’s own site', async () => {
    const order = await prisma.order.create({
      data: {
        organizationId: shop.id,
        reference: `WEB-${SUFFIX}`,
        paymentMethod: 'paystack',
        subtotal: 1000,
        totalAmount: 1000,
        confirmationToken: `tok-${SUFFIX}`,
        email: 'guest@example.com',
        firstName: 'Ada',
      },
    });
    expect((await shopSubscribe(shopRequest({ subscription: sub('g2'), order: order.confirmationToken }))).status).toBe(200);

    await notifyShopper(order.id, 'shipped');
    expect(push.sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(push.sendNotification.mock.calls[0][1] as string) as { body: string; url: string; tag: string };
    expect(payload).toEqual({
      title: 'Test store 0',
      body: `Order ${order.reference} is on its way.`,
      url: `http://${storefrontHost(shop.slug)}/checkout/confirmation?t=${order.confirmationToken}`,
      tag: `order:${order.id}`,
    });
  });
});

describe('installing', () => {
  it('serves the admin’s and a store’s manifest', async () => {
    const admin = (await adminManifest().json()) as { start_url: string; icons: { src: string }[]; display: string };
    expect(admin).toMatchObject({ start_url: '/', display: 'standalone' });
    expect(admin.icons.map((i) => i.src)).toContain('/app-icon/512');

    const store = await storeManifest(new Request('http://x/manifest.webmanifest'), { params: Promise.resolve({ organizationSlug: shop.slug }) });
    expect(store.headers.get('content-type')).toBe('application/manifest+json');
    expect(await store.json()).toMatchObject({ name: 'Test store 0', short_name: 'Test store 0', scope: '/' });

    const missing = await storeManifest(new Request('http://x/manifest.webmanifest'), { params: Promise.resolve({ organizationSlug: `nope-${SUFFIX}` }) });
    expect(missing.status).toBe(404);
  });
});
