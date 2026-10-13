/*
 * The notification bell and lists (ROADMAP 18.2), against the real database,
 * with Ably stubbed at the network.
 *
 *   - a member sees their own list in the shop they're in, platform staff see
 *     the console's, a shopper theirs — and nobody else's;
 *   - each entry links to the page for whoever reads it (a shopper's to
 *     their own account, not the emailed link);
 *   - opening one marks it read; someone else's id changes nothing;
 *   - the feed and token routes take the reader from the session, and the
 *     token listens to exactly that person's channel;
 *   - a new notification tells each recipient's open bell its new count,
 *     and nothing more.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const published = vi.hoisted(() => [] as { channel: string; event: string; data: unknown }[]);
vi.mock('ably', async (importOriginal) => {
  const real = await importOriginal<typeof import('ably')>();
  class Rest {
    auth: InstanceType<typeof real.Rest>['auth'];
    channels: { get: (name: string) => { publish: (event: string, data: unknown) => Promise<void> } };
    constructor(options: ConstructorParameters<typeof real.Rest>[0]) {
      this.auth = new real.Rest(options).auth; // signs token requests locally — no network
      this.channels = { get: (channel) => ({ publish: async (event, data) => void published.push({ channel, event, data }) }) };
    }
  }
  return { ...real, Rest };
});

const email = vi.hoisted(() => ({ sendStoreOrderAlertEmail: vi.fn(async () => true) }));
vi.mock('@/lib/email', async (original) => ({ ...(await original<typeof import('@/lib/email')>()), ...email }));

const session = vi.hoisted(() => ({ organizationId: '', userId: '', platformUserId: null as string | null }));
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: async () => ({ organization: { id: session.organizationId, name: 'Shop' }, userId: session.userId }),
}));
vi.mock('@/lib/platform-staff', () => ({
  getPlatformStaff: async () => (session.platformUserId ? { userId: session.platformUserId, name: 'Staff', email: 's@example.com' } : null),
}));

import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains } from './helpers/storefront-requests';
import { notify } from '@/lib/notifications/notify';
import {
  latestNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markThreadRead,
  unreadCount,
  type Reader,
} from '@/lib/notifications/inbox';
import { listChannelName } from '@/lib/notifications/realtime';
import { resetAblyClient } from '@/lib/realtime/ably';
import { discardAfterTasks, flushAfterTasks } from '@/lib/run-after';
import { POST as adminFeed } from '@/app/(dashboard)/[organizationSlug]/notifications/feed/route';
import { POST as adminToken } from '@/app/(dashboard)/[organizationSlug]/notifications/realtime-token/route';
import { POST as platformFeed } from '@/app/platform/notifications/feed/route';

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
let shop = { id: '', slug: '' };
let other = { id: '', slug: '' };
let cleanup = async () => {};
const users: string[] = [];
let ownerId = '';
let platformUserId = '';
let customerId = '';
const savedKey = process.env.ABLY_API_KEY;

async function ownerOf(organizationId: string) {
  const user = await prisma.user.create({ data: { email: `owner-${organizationId.slice(-6)}-${SUFFIX}@example.com` } });
  users.push(user.id);
  const role = await prisma.role.create({ data: { organizationId, name: 'Owner', isSystem: true } });
  await prisma.membership.create({ data: { userId: user.id, organizationId, roleId: role.id } });
  return user.id;
}

/** A row in someone's list, straight in — what notify() writes. */
async function entry(data: { userId?: string; customerId?: string; organizationId: string | null; target: object; title?: string; read?: boolean }) {
  const event = await prisma.notificationEvent.create({ data: { key: `t:${Math.random()}`, kind: 'order.alert', organizationId: data.organizationId } });
  return prisma.notification.create({
    data: {
      eventId: event.id,
      userId: data.userId,
      customerId: data.customerId,
      organizationId: data.organizationId,
      kind: 'order.alert',
      title: data.title ?? 'Order cancelled',
      body: 'Ada cancelled their order.',
      target: data.target,
      readAt: data.read ? new Date() : null,
    },
  });
}

const json = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  const made = await createTestStores('__test-bell', 2);
  cleanup = made.cleanup;
  [shop, other] = made.stores;
  ownerId = await ownerOf(shop.id);
  // The same person, a member of another shop too.
  const otherRole = await prisma.role.create({ data: { organizationId: other.id, name: 'Owner', isSystem: true } });
  await prisma.membership.create({ data: { userId: ownerId, organizationId: other.id, roleId: otherRole.id } });
  const staff = await prisma.user.create({ data: { email: `bell-platform-${SUFFIX}@example.com`, isPlatformStaff: true } });
  platformUserId = staff.id;
  users.push(staff.id);
  customerId = (await prisma.customer.create({ data: { organizationId: shop.id, name: 'Ada', email: `ada-${SUFFIX}@example.com`, passwordHash: 'x' } })).id;
}, 60_000);

beforeEach(async () => {
  published.length = 0;
  discardAfterTasks();
  delete process.env.ABLY_API_KEY;
  resetAblyClient();
  session.organizationId = shop.id;
  session.userId = ownerId;
  session.platformUserId = null;
  await prisma.notificationEvent.deleteMany({ where: { OR: [{ organizationId: { in: [shop.id, other.id] } }, { notifications: { some: { userId: platformUserId } } }] } });
});

afterAll(async () => {
  if (savedKey === undefined) delete process.env.ABLY_API_KEY;
  else process.env.ABLY_API_KEY = savedKey;
  resetAblyClient();
  await prisma.notificationEvent.deleteMany({ where: { OR: [{ organizationId: { in: [shop.id, other.id] } }, { notifications: { some: { userId: platformUserId } } }] } });
  await prisma.order.deleteMany({ where: { organizationId: shop.id } });
  await prisma.customer.deleteMany({ where: { organizationId: shop.id } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: [shop.id, other.id] } } });
  await prisma.role.deleteMany({ where: { organizationId: { in: [shop.id, other.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await cleanup();
}, 60_000);

describe('whose list it is', () => {
  it('keeps a member’s lists apart per shop, and apart from the console’s', async () => {
    const here = await entry({ userId: ownerId, organizationId: shop.id, target: { type: 'order', orderId: 'o1', reference: 'R1' } });
    await entry({ userId: ownerId, organizationId: other.id, target: { type: 'order', orderId: 'o2', reference: 'R2' } });
    await entry({ userId: platformUserId, organizationId: null, target: { type: 'platform', path: '/platform/jobs' } });

    const mine = await latestNotifications({ kind: 'staff', userId: ownerId, organizationId: shop.id });
    expect(mine.items.map((i) => i.id)).toEqual([here.id]);
    expect(mine.items[0].href).toBe('/sales/orders/o1');

    const console = await latestNotifications({ kind: 'platform', userId: platformUserId });
    expect(console.items.map((i) => i.href)).toEqual(['/platform/jobs']);
  });

  it('sends a signed-in shopper to their own order page, not the emailed link', async () => {
    await entry({ customerId, organizationId: shop.id, target: { type: 'order', orderId: 'o1', reference: 'R-9', confirmationToken: 'secret' } });
    const { items } = await latestNotifications({ kind: 'shopper', customerId, organizationId: shop.id });
    expect(items[0].href).toBe('/account/orders/R-9');
  });

  it('shows nothing for a target it doesn’t recognise', async () => {
    await entry({ userId: ownerId, organizationId: shop.id, target: { type: 'something-else', url: 'https://evil.example' } });
    const { items } = await latestNotifications({ kind: 'staff', userId: ownerId, organizationId: shop.id });
    expect(items[0].href).toBeNull();
  });
});

describe('reading and clearing', () => {
  const me: Reader = { kind: 'staff', userId: '', organizationId: '' };
  beforeEach(() => Object.assign(me, { userId: ownerId, organizationId: shop.id }));

  it('marks one read when opened, and ignores someone else’s id', async () => {
    const mine = await entry({ userId: ownerId, organizationId: shop.id, target: { type: 'order', orderId: 'o1', reference: 'R1' } });
    const theirs = await entry({ userId: platformUserId, organizationId: null, target: { type: 'platform', path: '/platform/jobs' } });

    expect(await markNotificationRead(me, theirs.id)).toBe(false);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    expect(await markNotificationRead(me, mine.id)).toBe(true);
    expect(await unreadCount(me)).toBe(0);
  });

  it('marks a whole thread read when the thing itself is opened', async () => {
    const shopper: Reader = { kind: 'shopper', customerId, organizationId: shop.id };
    const thread = await entry({ customerId, organizationId: shop.id, target: { type: 'order', orderId: 'o7', reference: 'R7' } });
    await prisma.notification.update({ where: { id: thread.id }, data: { threadKey: 'order:o7' } });
    const other = await entry({ customerId, organizationId: shop.id, target: { type: 'order', orderId: 'o8', reference: 'R8' } });
    await prisma.notification.update({ where: { id: other.id }, data: { threadKey: 'order:o8' } });

    await markThreadRead(shopper, 'order:o7');
    expect(await unreadCount(shopper)).toBe(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt).toBeNull();
  });

  it('filters to unread, pages, and marks everything read', async () => {
    for (let i = 0; i < 23; i++) await entry({ userId: ownerId, organizationId: shop.id, target: { type: 'order', orderId: `o${i}`, reference: `R${i}` }, read: i < 3 });
    const unread = await listNotifications(me, { unreadOnly: true });
    expect(unread).toMatchObject({ total: 20, unread: 20, any: true });
    const second = await listNotifications(me, { page: 2 });
    expect(second.items).toHaveLength(3);

    expect(await markAllNotificationsRead(me)).toBe(20);
    expect(await listNotifications(me, { unreadOnly: true })).toMatchObject({ total: 0, any: true });
  });
});

describe('the routes', () => {
  it('answers the member’s own count and list, and only for JSON', async () => {
    const mine = await entry({ userId: ownerId, organizationId: shop.id, target: { type: 'order', orderId: 'o1', reference: 'R1' } });
    expect((await adminFeed(new Request('http://localhost/notifications/feed', { method: 'POST', body: '{}' }))).status).toBe(415);

    expect(await (await adminFeed(json('/notifications/feed', {}))).json()).toEqual({ unread: 1 });
    const open = (await (await adminFeed(json('/notifications/feed', { latest: true }))).json()) as { items: { id: string }[] };
    expect(open.items.map((i) => i.id)).toEqual([mine.id]);

    expect(await (await adminFeed(json('/notifications/feed', { read: mine.id }))).json()).toEqual({ unread: 0 });
  });

  it('hides the console’s feed from anyone who isn’t platform staff', async () => {
    expect((await platformFeed(json('/platform/notifications/feed', {}))).status).toBe(404);
    session.platformUserId = platformUserId;
    expect((await platformFeed(json('/platform/notifications/feed', {}))).status).toBe(200);
  });

  it('gives a listen-only token for exactly this member’s list in this shop', async () => {
    expect((await adminToken(json('/notifications/realtime-token', {}))).status).toBe(503);

    process.env.ABLY_API_KEY = 'appid.keyid:secretsecretsecret';
    resetAblyClient();
    const response = await adminToken(json('/notifications/realtime-token', {}));
    const body = (await response.json()) as { channel: string; tokenRequest: { capability: string } };
    const channel = listChannelName({ kind: 'staff', userId: ownerId, organizationId: shop.id });
    expect(body.channel).toBe(channel);
    expect(JSON.parse(body.tokenRequest.capability)).toEqual({ [channel]: ['subscribe'] });
  });
});

describe('telling an open bell', () => {
  it('publishes each recipient’s new unread count, and nothing else', async () => {
    process.env.ABLY_API_KEY = 'appid.keyid:secretsecretsecret';
    resetAblyClient();
    await notify({
      kind: 'order.alert',
      organizationId: shop.id,
      facts: { kind: 'customer-cancelled', orderId: 'o1', reference: 'R1', customerName: 'Ada' },
    });
    expect(published).toHaveLength(0); // after the response, not during it
    await flushAfterTasks();

    expect(published).toEqual([
      { channel: listChannelName({ kind: 'staff', userId: ownerId, organizationId: shop.id }), event: 'change', data: { unread: 1 } },
    ]);
  });

  it('tells the bell when one is opened elsewhere', async () => {
    process.env.ABLY_API_KEY = 'appid.keyid:secretsecretsecret';
    resetAblyClient();
    const mine = await entry({ userId: ownerId, organizationId: shop.id, target: { type: 'order', orderId: 'o1', reference: 'R1' } });
    await markNotificationRead({ kind: 'staff', userId: ownerId, organizationId: shop.id }, mine.id);
    expect(published.map((p) => p.data)).toEqual([{ unread: 0 }]);
  });
});

