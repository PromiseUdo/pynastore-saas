/*
 * Order notifications in a store's own app (ROADMAP 16.4), against the real
 * database, with Google and Apple stubbed at the network.
 *
 *   - offered only in a store app built with push, for its own store, on a
 *     phone the platform holds credentials for;
 *   - a device is linked only to the order it asked about;
 *   - an order change reaches it, and a token the platform calls dead is
 *     deleted;
 *   - watches end after 60 days.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains } from './helpers/storefront-requests';

vi.mock('@/lib/mobile/push/apns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mobile/push/apns')>()),
  sendApns: vi.fn(async () => 'sent'),
}));

const { pushReadyFor, watchOrder, purgeOldPushWatches } = await import('@/lib/mobile/push/watch');
const { pushOrderUpdate } = await import('@/lib/mobile/push/send');
const { resetFcmTokenCache } = await import('@/lib/mobile/push/fcm');
const { sendApns } = await import('@/lib/mobile/push/apns');
const { seal, resetSocialKeyCache } = await import('@/lib/social/crypto');

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
const A_APP = `com.pusha${SUFFIX}.shop`;
const B_APP = `com.pushb${SUFFIX}.shop`;
const ANDROID_UA = (appId: string, push = true) =>
  `Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36 MansaasApp/${appId}${push ? ' MansaasPush' : ''}`;
const IOS_UA = (appId: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 MansaasApp/${appId} MansaasPush`;
const FCM_TOKEN = `fcm-${'x'.repeat(140)}`;
const APNS_TOKEN = 'a1'.repeat(32);

const A = { id: '', slug: '' };
const B = { id: '', slug: '' };
let cleanup = async () => {};
const savedAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
const savedSocialKey = process.env.SOCIAL_TOKEN_KEY;

async function newOrder(organizationId: string) {
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  const order = await prisma.order.create({
    data: {
      organizationId,
      reference: `PUSH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      paymentMethod: 'paystack',
      subtotal: 1000,
      totalAmount: 1000,
      confirmationToken: token,
      email: 'shopper@example.com',
      firstName: 'Ada',
    },
    select: { id: true, reference: true },
  });
  return { ...order, token };
}

/** Google's token endpoint and FCM, as fetch sees them. */
function stubGoogle(send: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
      }
      return send();
    }),
  );
  return calls;
}

beforeAll(async () => {
  const made = await createTestStores('push', 2);
  cleanup = made.cleanup;
  Object.assign(A, made.stores[0]);
  Object.assign(B, made.stores[1]);
  await prisma.mobileApp.create({ data: { organizationId: A.id, appId: A_APP, name: 'Push A' } });
  await prisma.mobileApp.create({ data: { organizationId: B.id, appId: B_APP, name: 'Push B' } });

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: 'notely-test',
    client_email: 'push@notely-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  process.env.AUTH_SECRET ||= 'test-secret-for-storefront-sessions';
  // The sealed APNs key needs a real key to seal with.
  process.env.SOCIAL_TOKEN_KEY = randomBytes(32).toString('base64');
  resetSocialKeyCache();
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  resetFcmTokenCache();
});

afterAll(async () => {
  if (savedAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = savedAccount;
  if (savedSocialKey === undefined) delete process.env.SOCIAL_TOKEN_KEY;
  else process.env.SOCIAL_TOKEN_KEY = savedSocialKey;
  resetSocialKeyCache();
  await prisma.order.deleteMany({ where: { organizationId: { in: [A.id, B.id] } } }); // watches cascade
  await cleanup(); // devices and apps go with the stores
}, 60_000);

describe('when notifications are offered', () => {
  it('in a store app built with push, for its own store, on Android with Firebase set up', async () => {
    await expect(pushReadyFor(ANDROID_UA(A_APP), A.slug)).resolves.toBe(true);
  });

  it('not in a build without push, not for another store, not in a browser', async () => {
    await expect(pushReadyFor(ANDROID_UA(A_APP, false), A.slug)).resolves.toBe(false);
    await expect(pushReadyFor(ANDROID_UA(A_APP), B.slug)).resolves.toBe(false);
    await expect(pushReadyFor('Mozilla/5.0 (Linux; Android 15) Chrome/129 Mobile', A.slug)).resolves.toBe(false);
  });

  it('on iPhone only once the merchant’s APNs key is recorded', async () => {
    await expect(pushReadyFor(IOS_UA(A_APP), A.slug)).resolves.toBe(false);
    await prisma.mobileApp.update({
      where: { appId: A_APP },
      data: { apnsTeamId: 'ABCDE12345', apnsKeyId: 'KEY1234567', apnsKeySealed: seal('not-a-real-key') },
    });
    await expect(pushReadyFor(IOS_UA(A_APP), A.slug)).resolves.toBe(true);
  });
});

describe('asking about an order', () => {
  it('links the device to that order only', async () => {
    const order = await newOrder(A.id);
    await expect(
      watchOrder({ organizationSlug: A.slug, confirmationToken: order.token, deviceToken: FCM_TOKEN, userAgent: ANDROID_UA(A_APP) }),
    ).resolves.toBe('watching');
    const device = await prisma.pushDevice.findUniqueOrThrow({
      where: { appId_token: { appId: A_APP, token: FCM_TOKEN } },
      select: { platform: true, organizationId: true, watches: { select: { orderId: true } } },
    });
    expect(device).toEqual({ platform: 'ANDROID', organizationId: A.id, watches: [{ orderId: order.id }] });
  });

  it("refuses another store's order, a made-up token, or a build without push", async () => {
    const theirs = await newOrder(B.id);
    await expect(
      watchOrder({ organizationSlug: A.slug, confirmationToken: theirs.token, deviceToken: FCM_TOKEN, userAgent: ANDROID_UA(A_APP) }),
    ).resolves.toBe('not-found');
    const ours = await newOrder(A.id);
    await expect(
      watchOrder({ organizationSlug: A.slug, confirmationToken: ours.token, deviceToken: 'bad token!', userAgent: ANDROID_UA(A_APP) }),
    ).resolves.toBe('invalid-token');
    await expect(
      watchOrder({ organizationSlug: A.slug, confirmationToken: ours.token, deviceToken: FCM_TOKEN, userAgent: ANDROID_UA(A_APP, false) }),
    ).resolves.toBe('unavailable');
  });
});

describe('telling the phone', () => {
  it('sends an Android notification through FCM, opening the order in the app', async () => {
    const order = await newOrder(A.id);
    await watchOrder({ organizationSlug: A.slug, confirmationToken: order.token, deviceToken: FCM_TOKEN, userAgent: ANDROID_UA(A_APP) });

    let sentBody: { message: { token: string; notification: { body: string }; data: { path: string } } } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
        }
        sentBody = JSON.parse(String(init?.body));
        return new Response('{}', { status: 200 });
      }),
    );

    await expect(pushOrderUpdate(order.id, 'shipped')).resolves.toEqual({ sent: 1, gone: 0, failed: 0 });
    expect(sentBody!.message.token).toBe(FCM_TOKEN);
    expect(sentBody!.message.notification.body).toBe(`Order ${order.reference} is on its way.`);
    expect(sentBody!.message.data.path).toBe(`/s/${A.slug}/checkout/confirmation?t=${order.token}`);
  });

  it("says nothing for changes the shopper made themselves", async () => {
    const order = await newOrder(A.id);
    await watchOrder({ organizationSlug: A.slug, confirmationToken: order.token, deviceToken: FCM_TOKEN, userAgent: ANDROID_UA(A_APP) });
    const calls = stubGoogle(() => new Response('{}', { status: 200 }));
    await expect(pushOrderUpdate(order.id, 'cancelled-by-you')).resolves.toEqual({ sent: 0, gone: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it('forgets a device Firebase says is gone', async () => {
    const token = `gone-${'y'.repeat(140)}`;
    const order = await newOrder(A.id);
    await watchOrder({ organizationSlug: A.slug, confirmationToken: order.token, deviceToken: token, userAgent: ANDROID_UA(A_APP) });
    stubGoogle(() => new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 }));

    await expect(pushOrderUpdate(order.id, 'delivered')).resolves.toMatchObject({ gone: 1 });
    await expect(prisma.pushDevice.findUnique({ where: { appId_token: { appId: A_APP, token } } })).resolves.toBeNull();
  });

  it("sends an iPhone notification with the merchant's own key", async () => {
    const order = await newOrder(A.id);
    await watchOrder({ organizationSlug: A.slug, confirmationToken: order.token, deviceToken: APNS_TOKEN, userAgent: IOS_UA(A_APP) });
    await expect(pushOrderUpdate(order.id, 'payment-received')).resolves.toMatchObject({ sent: 1 });
    expect(sendApns).toHaveBeenLastCalledWith(
      APNS_TOKEN,
      { title: 'Test store 0', body: `Payment received for order ${order.reference}.` },
      { path: `/s/${A.slug}/checkout/confirmation?t=${order.token}` },
      { teamId: 'ABCDE12345', keyId: 'KEY1234567', key: 'not-a-real-key', topic: A_APP },
    );
  });
});

describe('cleaning up', () => {
  it('ends a watch after 60 days, then the device', async () => {
    const token = `old-${'z'.repeat(140)}`;
    const order = await newOrder(A.id);
    await watchOrder({ organizationSlug: A.slug, confirmationToken: order.token, deviceToken: token, userAgent: ANDROID_UA(A_APP) });
    const later = new Date(Date.now() + 61 * 86_400_000);
    await purgeOldPushWatches(later);
    await expect(prisma.pushDevice.findUnique({ where: { appId_token: { appId: A_APP, token } } })).resolves.toBeNull();
  });
});
