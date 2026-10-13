/*
 * The business app's native pieces (ROADMAP 19.4):
 *   - staff phones: a phone belongs to a PERSON (no shop), hears about every
 *     shop they're in, opens /o/{slug}/… when tapped, and shows their unread
 *     count across shops; registering it, moving it, stopping it;
 *   - the platform's own APNs key;
 *   - the small pure pieces: entry paths, a receipt as words, the iPhone
 *     permission text.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

const sent = vi.hoisted(() => [] as { token: string; appId: string; organizationId: string | null; data: Record<string, string>; badge?: number; thread?: string }[]);
vi.mock('@/lib/mobile/push/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mobile/push/send')>()),
  sendToDevice: vi.fn(async (device: { token: string; appId: string; organizationId: string | null }, _message: unknown, data: Record<string, string>, options: { badge?: number; thread?: string } = {}) => {
    sent.push({ token: device.token, appId: device.appId, organizationId: device.organizationId, data, ...options });
    return { outcome: 'sent' };
  }),
}));
const state = vi.hoisted(() => ({ session: null as null | { user: { id: string } } }));
vi.mock('@/lib/auth', () => ({ auth: async () => state.session }));
vi.mock('@/lib/run-after', () => ({ runAfter: (fn: () => unknown) => void fn() }));

const APNS = vi.hoisted(() => {
  // A throwaway P-256 key: the route only checks that the platform's key is configured.
  const { generateKeyPairSync } = require('crypto') as typeof import('crypto');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
});
process.env.APNS_BUSINESS_KEY = APNS.key.replace(/\n/g, '\\n');
process.env.APNS_BUSINESS_KEY_ID = 'KEYID12345';
process.env.APNS_BUSINESS_TEAM_ID = 'TEAMID1234';

const { notify } = await import('@/lib/notifications/notify');
const { sendNativePush } = await import('@/lib/notifications/channels/native-push');
const { syncAppBadges } = await import('@/lib/notifications/badges');
const { businessApnsCredentials } = await import('@/lib/mobile/push/send');
const { BUSINESS_APP_ID } = await import('@/lib/mobile/app-config');
const { businessAppPathFor } = await import('@/lib/notifications/links');
const { isBusinessEntryPath } = await import('@/lib/business-app/client');
const { receiptText } = await import('@/components/sales/receipt-document');
const { editIosInfoPlist, BUSINESS_PHOTO_PURPOSE } = await import('@/scripts/mobile/native-project');
const route = await import('@/app/(dashboard)/[organizationSlug]/notifications/native-push/route');
const { readFileSync } = await import('fs');

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const iosToken = (n: number) => `${n.toString(16).padStart(2, '0')}${'a'.repeat(62)}`;
const APP_UA = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 MansaasApp/${BUSINESS_APP_ID} MansaasPush`;

let owner = { id: '' };
let stranger = { id: '' };
const orgs: { id: string; slug: string }[] = [];

beforeAll(async () => {
  owner = await prisma.user.create({ data: { email: `native-owner-${stamp}@example.test`, name: 'Owner' } });
  stranger = await prisma.user.create({ data: { email: `native-other-${stamp}@example.test`, name: 'Other' } });
  for (const n of [1, 2]) {
    const org = await prisma.organization.create({ data: { name: `Native ${n}`, slug: `__test-native-${n}-${stamp}` } });
    const role = await prisma.role.create({ data: { organizationId: org.id, name: 'Owner', isSystem: true } });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, roleId: role.id } });
    orgs.push({ id: org.id, slug: org.slug });
  }
});

afterAll(async () => {
  await prisma.pushDevice.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } });
  await prisma.notificationEvent.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
});

beforeEach(async () => {
  sent.length = 0;
  state.session = null;
  await prisma.pushDevice.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } });
});

const businessPhone = (userId: string, n: number, platform: 'IOS' | 'ANDROID' = 'IOS') =>
  prisma.pushDevice.create({ data: { appId: BUSINESS_APP_ID, platform, token: iosToken(n), userId, organizationId: null } });

describe('a staff member’s phone', () => {
  it('hears about a new order in any shop they’re in, and opens it in that shop', async () => {
    await businessPhone(owner.id, 1);
    await businessPhone(stranger.id, 2); // not in this shop: hears nothing
    const order = { orderId: `ord-${stamp}`, reference: 'R-100' };
    await notify({
      kind: 'order.new',
      organizationId: orgs[1].id,
      key: `native-new-${stamp}`,
      facts: { ...order, customerName: 'Ada', total: '₦5,000', payment: 'on-delivery' },
    });

    expect(sent.map((s) => s.token)).toEqual([iosToken(1)]);
    expect(sent[0]).toMatchObject({ appId: BUSINESS_APP_ID, organizationId: null, data: { path: `/o/${orgs[1].slug}/sales/orders/${order.orderId}` } });
    expect(sent[0].thread).toBeTruthy();
    // Its badge counts what's unread for them — the order just listed included.
    expect(sent[0].badge).toBeGreaterThanOrEqual(1);
  });

  it('its badge counts every shop', async () => {
    const device = await businessPhone(owner.id, 3);
    const unreadBefore = await prisma.notification.count({ where: { userId: owner.id, readAt: null } });
    for (const org of orgs) {
      const event = await prisma.notificationEvent.create({ data: { key: `badge-${org.id}-${stamp}`, kind: 'order.new', organizationId: org.id } });
      await prisma.notification.create({ data: { eventId: event.id, userId: owner.id, organizationId: org.id, kind: 'order.new', title: 't', body: 'b', target: {} } });
    }
    await sendNativePush(device.id, { title: 't', body: 'b', path: `/o/${orgs[0].slug}/dashboard` });
    expect(sent.at(-1)!.badge).toBe(unreadBefore + 2);

    sent.length = 0;
    await syncAppBadges({ kind: 'staff', userId: owner.id, organizationId: orgs[0].id });
    expect(sent).toEqual([expect.objectContaining({ token: iosToken(3), badge: unreadBefore + 2 })]);
  });

  it('is reached with the platform’s own APNs key', () => {
    expect(businessApnsCredentials()).toMatchObject({ keyId: 'KEYID12345', teamId: 'TEAMID1234', topic: BUSINESS_APP_ID });
    expect(businessApnsCredentials()!.key).toContain('-----BEGIN PRIVATE KEY-----\n');
  });
});

describe('turning phone notifications on and off', () => {
  const call = (method: 'POST' | 'DELETE', body: unknown, headers: Record<string, string> = {}) =>
    route[method](
      new Request('http://b.app.localhost:3000/notifications/native-push', {
        method,
        headers: { host: 'b.app.localhost:3000', origin: 'http://b.app.localhost:3000', 'content-type': 'application/json', 'user-agent': APP_UA, ...headers },
        body: JSON.stringify(body),
      }),
    );

  it('records this phone for the person signed in, for no one shop', async () => {
    state.session = { user: { id: owner.id } };
    expect((await call('POST', { token: iosToken(9) })).status).toBe(200);
    expect(await prisma.pushDevice.findFirst({ where: { token: iosToken(9) } })).toMatchObject({ userId: owner.id, organizationId: null, appId: BUSINESS_APP_ID, platform: 'IOS' });
  });

  it('the same phone signed in as someone else becomes theirs; only its owner can stop it', async () => {
    state.session = { user: { id: owner.id } };
    await call('POST', { token: iosToken(9) });
    state.session = { user: { id: stranger.id } };
    await call('POST', { token: iosToken(9) });
    expect((await prisma.pushDevice.findFirst({ where: { token: iosToken(9) } }))!.userId).toBe(stranger.id);

    state.session = { user: { id: owner.id } };
    expect(await (await call('DELETE', { token: iosToken(9) })).json()).toEqual({ ok: false });
    state.session = { user: { id: stranger.id } };
    expect(await (await call('DELETE', { token: iosToken(9) })).json()).toEqual({ ok: true });
    expect(await prisma.pushDevice.count({ where: { token: iosToken(9) } })).toBe(0);
  });

  it('refuses a browser, a store’s app, another site, a made-up token and no session', async () => {
    expect((await call('POST', { token: iosToken(9) })).status).toBe(401);
    state.session = { user: { id: owner.id } };
    expect((await call('POST', { token: iosToken(9) }, { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' })).status).toBe(404);
    expect((await call('POST', { token: iosToken(9) }, { 'user-agent': 'Mozilla/5.0 (iPhone) MansaasApp/com.pynacode.shop MansaasPush' })).status).toBe(404);
    expect((await call('POST', { token: iosToken(9) }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', { token: 'not-a-token' })).status).toBe(400);
  });
});

describe('the small pieces', () => {
  it('a notification opens its admin page through /o/{slug}/…, and the app follows nothing else', () => {
    expect(businessAppPathFor({ type: 'order', orderId: 'o1', reference: 'R1' }, 'acme')).toBe('/o/acme/sales/orders/o1');
    expect(isBusinessEntryPath('/o/acme/sales/orders/o1')).toBe(true);
    expect(isBusinessEntryPath('/o/acme')).toBe(true);
    for (const bad of ['//evil.example/o/x', '/s/acme/products', 'https://evil.example/o/acme', '/o//x', '/o/acme//evil']) {
      expect(isBusinessEntryPath(bad), bad).toBe(false);
    }
  });

  it('a receipt reads as plain words for sharing', () => {
    expect(
      receiptText({
        businessName: 'Ada’s Shop',
        title: 'Receipt R-1',
        facts: [{ label: 'Date', value: '13 Oct 2026' }],
        lines: [{ name: 'Tee', variantName: 'Large', quantity: 2, unitPrice: '₦2,500', total: '₦5,000' }],
        totals: [{ label: 'Subtotal', value: '₦5,000' }],
        total: { label: 'Total', value: '₦5,000' },
        footerFacts: [{ label: 'Paid', value: 'Cash' }],
        note: 'Thank you',
      }),
    ).toBe(['Ada’s Shop', 'Receipt R-1', 'Date: 13 Oct 2026', '', '2 × Tee (Large) — ₦5,000', '', 'Subtotal: ₦5,000', 'Total: ₦5,000', 'Paid: Cash', '', 'Thank you'].join('\n'));
  });

  it('every iPhone app says why it wants the camera and photos, in its own words', () => {
    const plist = readFileSync('ios/App/App/Info.plist', 'utf8');
    expect(plist).toContain('<key>NSCameraUsageDescription</key>');
    expect(plist).toContain('<key>NSPhotoLibraryUsageDescription</key>');
    const business = editIosInfoPlist(plist, { appId: BUSINESS_APP_ID, name: 'Notely Business', photos: BUSINESS_PHOTO_PURPOSE });
    expect(business).toContain(`<string>${BUSINESS_PHOTO_PURPOSE.camera}</string>`);
    expect(business).toContain(`<string>${BUSINESS_PHOTO_PURPOSE.library}</string>`);
  });
});
