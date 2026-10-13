/*
 * The notification seam (ROADMAP 18.1), against the real database, with the
 * email provider and the browsers' push services stubbed.
 *
 *   - every kind leads somewhere on every surface it's sent to;
 *   - staff hear by permission (and the Owner), each in their own list, by
 *     one email; a choice turns a channel off unless it's required;
 *   - an event raised twice is sent once;
 *   - a failed send waits and is retried, and is given up after 5 tries;
 *   - a browser opens the page on its own origin, and one that's gone is
 *     forgotten;
 *   - platform staff, signed-in shoppers and guests each get theirs;
 *   - lists are cleared after 90 days, and with a shopper's account.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const email = vi.hoisted(() => ({
  sendStoreOrderAlertEmail: vi.fn(async (_payload: { to: string[] }) => true as boolean),
  sendStorefrontOrderUpdateEmail: vi.fn(async (_payload: { to: string }) => true as boolean),
  sendPaymentDisputeEmail: vi.fn(async (_payload: { to: string[] }) => true as boolean),
  sendPlatformNoticeEmail: vi.fn(async (_payload: { to: string | string[] }) => true as boolean),
}));
vi.mock('@/lib/email', async (original) => ({ ...(await original<typeof import('@/lib/email')>()), ...email }));

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

import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains } from './helpers/storefront-requests';
import { notify } from '@/lib/notifications/notify';
import { EVENTS, type EventFacts, type NotificationKind } from '@/lib/notifications/events';
import { pathFor, type Surface } from '@/lib/notifications/links';
import { MAX_ATTEMPTS, retryDueDeliveries } from '@/lib/notifications/outbox';
import { notifyMerchant, notifyShopper } from '@/lib/storefront/orders/notifications';
import { runDataRetention } from '@/lib/data-rights/retention';
import { deleteShopperAccount } from '@/lib/data-rights/shopper';
import { PERMISSIONS } from '@/lib/permissions';

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
let store = { id: '', slug: '' };
let cleanup = async () => {};
const users: string[] = [];
let ownerId = '';
let ownerEmail = '';
let packerEmail = '';
let platformUserId = '';
const savedEnv = { ...process.env };

async function member(roleName: string, isSystem: boolean, permissions: string[], status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const user = await prisma.user.create({ data: { email: `${roleName.toLowerCase().replace(/\s/g, '')}-${status}-${SUFFIX}@example.com` } });
  users.push(user.id);
  const role = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: store.id, name: roleName } },
    create: { organizationId: store.id, name: roleName, isSystem },
    update: {},
  });
  for (const key of permissions) {
    const permission = await prisma.permission.upsert({ where: { key }, create: { key, module: key.split('.')[0] }, update: {} });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      create: { roleId: role.id, permissionId: permission.id },
      update: {},
    });
  }
  await prisma.membership.create({ data: { userId: user.id, organizationId: store.id, roleId: role.id, status } });
  return user;
}

async function newOrder(customerId: string | null = null) {
  return prisma.order.create({
    data: {
      organizationId: store.id,
      customerId,
      reference: `NOTE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      paymentMethod: 'paystack',
      subtotal: 1000,
      totalAmount: 1000,
      confirmationToken: `tok-${Math.random().toString(36).slice(2)}`,
      email: `shopper-${Math.random().toString(36).slice(2, 6)}@example.com`,
      firstName: 'Ada',
    },
    select: { id: true, reference: true, email: true, confirmationToken: true },
  });
}

async function shopperWithAccount() {
  return prisma.customer.create({
    data: { organizationId: store.id, name: 'Ada Shopper', email: `ada-${Math.random().toString(36).slice(2, 6)}@example.com`, passwordHash: 'x' },
    select: { id: true },
  });
}

beforeAll(async () => {
  const made = await createTestStores('__test-notify', 1);
  cleanup = made.cleanup;
  [store] = made.stores;
  const owner = await member('Owner', true, []);
  ownerId = owner.id;
  ownerEmail = owner.email!;
  packerEmail = (await member('Packer', false, [PERMISSIONS.SALES_FULFILLMENT_MANAGE])).email!;
  await member('Bookkeeper', false, [PERMISSIONS.SALES_VIEW]);
  await member('Former packer', false, [PERMISSIONS.SALES_FULFILLMENT_MANAGE], 'SUSPENDED');
  const staff = await prisma.user.create({ data: { email: `platform-${SUFFIX}@example.com`, isPlatformStaff: true } });
  platformUserId = staff.id;
  users.push(staff.id);

  process.env.PLATFORM_ADMIN_EMAIL = `ops-${SUFFIX}@example.com`;
  process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY = 'BPublicKeyForTests';
  process.env.WEB_PUSH_PRIVATE_KEY = 'private-key-for-tests';
  process.env.WEB_PUSH_SUBJECT = 'mailto:ops@example.com';
}, 60_000);

beforeEach(async () => {
  for (const fn of Object.values(email)) {
    fn.mockClear();
    fn.mockResolvedValue(true);
  }
  push.sendNotification.mockClear();
  push.sendNotification.mockResolvedValue({ statusCode: 201 });
  await prisma.notificationPreference.deleteMany({ where: { organizationId: store.id } });
  await prisma.webPushSubscription.deleteMany({ where: { OR: [{ organizationId: store.id }, { userId: platformUserId }] } });
});

afterAll(async () => {
  process.env = savedEnv;
  await prisma.notificationEvent.deleteMany({ where: { OR: [{ organizationId: store.id }, { notifications: { some: { userId: platformUserId } } }] } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.auditLog.deleteMany({ where: { organizationId: store.id } }); // from deleting a shopper's account
  await prisma.membership.deleteMany({ where: { organizationId: store.id } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await cleanup();
}, 60_000);

describe('the catalogue', () => {
  const samples: { [K in NotificationKind]: EventFacts[K] } = {
    'order.update': { kind: 'shipped', orderId: 'o1', reference: 'R1', confirmationToken: 't', storeName: 'S' },
    'order.alert': { kind: 'return-requested', orderId: 'o1', reference: 'R1', returnId: 'r1', customerName: 'Ada' },
    'chat.message': { conversationId: 'c1', shopperName: null },
    'chat.reply': { conversationId: 'c1', storeName: 'S' },
    'stock.low': { warehouseId: 'w1', warehouseName: 'Lagos', itemName: 'Shoe', quantity: 2 },
    'payment.dispute': { kind: 'opened', orderId: 'o1', reference: 'R1', amount: '₦1,000' },
    'platform.alert': { heading: 'A job failed', path: '/platform/jobs' },
    'platform.domain-order': { shopName: 'S', domain: 'shoes.ng', type: 'REGISTER' },
    'platform.mobile-app-paid': { appOrderId: 'a1', shopName: 'S', appName: 'Shoes' },
  };
  const surfaceOf = { staff: 'admin', 'order-shopper': 'store', 'chat-shopper': 'store', platform: 'platform' } as const;

  it('leads somewhere on every surface each kind is sent to', () => {
    for (const kind of Object.keys(EVENTS) as NotificationKind[]) {
      const definition = EVENTS[kind] as (typeof EVENTS)[NotificationKind];
      const facts = samples[kind] as never;
      for (const audience of definition.audiences(facts)) {
        const surface: Surface = surfaceOf[audience.type];
        expect(pathFor(definition.target(facts), surface), `${kind} on ${surface}`).toMatch(/^\//);
      }
    }
  });

  it('never puts a chat message in a shopper’s notification', () => {
    expect(EVENTS['chat.reply'].words(samples['chat.reply'])).toEqual({ title: 'S', body: 'The store replied to your message.' });
  });
});

describe('telling staff', () => {
  it('lists it for, and emails once, the members who can act and the Owner', async () => {
    const order = await newOrder();
    await notifyMerchant(order.id, 'customer-cancelled');

    expect(email.sendStoreOrderAlertEmail).toHaveBeenCalledTimes(1);
    expect(email.sendStoreOrderAlertEmail.mock.calls[0][0].to.sort()).toEqual([ownerEmail, packerEmail].sort());
    const listed = await prisma.notification.findMany({ where: { organizationId: store.id, kind: 'order.alert', target: { path: ['orderId'], equals: order.id } } });
    expect(listed).toHaveLength(2);
    expect(listed[0].title).toBe(`Order ${order.reference} cancelled`);
  });

  it('leaves out someone who turned the email off, but keeps it in their list', async () => {
    await prisma.notificationPreference.create({
      data: { userId: ownerId, organizationId: store.id, scope: store.id, category: 'orders', channel: 'EMAIL', enabled: false },
    });
    const order = await newOrder();
    await notifyMerchant(order.id, 'customer-cancelled');
    expect(email.sendStoreOrderAlertEmail.mock.calls[0][0].to).toEqual([packerEmail]);
    expect(await prisma.notification.count({ where: { userId: ownerId, target: { path: ['orderId'], equals: order.id } } })).toBe(1);
  });

  it('still emails a required one', async () => {
    await prisma.notificationPreference.create({
      data: { userId: ownerId, organizationId: store.id, scope: store.id, category: 'payments', channel: 'EMAIL', enabled: false },
    });
    const order = await newOrder();
    await notify({
      kind: 'payment.dispute',
      organizationId: store.id,
      facts: { kind: 'opened', orderId: order.id, reference: order.reference, amount: '₦1,000' },
      email: { template: 'payment-dispute', props: { kind: 'opened', storeName: 'S', reference: order.reference, amount: '₦1,000', dueDate: null, resolution: null, orderUrl: 'https://x' } },
    });
    // The Owner, the packer, and the platform.
    expect(email.sendPaymentDisputeEmail.mock.calls[0][0].to).toEqual(expect.arrayContaining([ownerEmail, packerEmail, process.env.PLATFORM_ADMIN_EMAIL]));
  });

  it('sends an event raised twice only once', async () => {
    const order = await newOrder();
    const raise = () =>
      notify({
        kind: 'order.alert',
        organizationId: store.id,
        key: `test:${order.id}`,
        facts: { kind: 'customer-cancelled', orderId: order.id, reference: order.reference, customerName: 'Ada' },
      });
    const [first, second] = await Promise.all([raise(), raise()]);
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    expect((await raise()).duplicate).toBe(true);
    expect(await prisma.notificationEvent.count({ where: { key: `test:${order.id}` } })).toBe(1);
  });
});

describe('the outbox', () => {
  it('retries a failed email later, then forgets what it said', async () => {
    email.sendStoreOrderAlertEmail.mockResolvedValueOnce(false);
    const order = await newOrder();
    await notifyMerchant(order.id, 'customer-cancelled');

    const [delivery] = await prisma.notificationDelivery.findMany({ where: { channel: 'EMAIL', event: { notifications: { some: { target: { path: ['orderId'], equals: order.id } } } } } });
    expect(delivery).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'temporary failure' });
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    // Not yet due.
    await retryDueDeliveries({ now: new Date() });
    expect(email.sendStoreOrderAlertEmail).toHaveBeenCalledTimes(1);

    await retryDueDeliveries({ now: new Date(Date.now() + 2 * 60_000) });
    expect(email.sendStoreOrderAlertEmail).toHaveBeenCalledTimes(2);
    const sent = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(sent).toMatchObject({ status: 'SENT', attempts: 2, payload: null });
  });

  it(`gives up after ${MAX_ATTEMPTS} tries`, async () => {
    email.sendStoreOrderAlertEmail.mockResolvedValue(false);
    const order = await newOrder();
    await notifyMerchant(order.id, 'customer-cancelled');
    const where = { channel: 'EMAIL' as const, event: { notifications: { some: { target: { path: ['orderId'], equals: order.id } } } } };

    let later = Date.now();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      later += 3 * 3_600_000;
      await retryDueDeliveries({ now: new Date(later) });
    }
    const [delivery] = await prisma.notificationDelivery.findMany({ where });
    expect(delivery).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, payload: null });
    expect(email.sendStoreOrderAlertEmail).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });
});

describe('browsers', () => {
  async function staffBrowser(endpoint: string) {
    return prisma.webPushSubscription.create({
      data: {
        endpoint,
        p256dh: 'p',
        auth: 'a',
        origin: `https://${store.slug}.example.com`,
        label: 'Chrome on Android',
        audience: 'STAFF',
        userId: ownerId,
        organizationId: store.id,
      },
    });
  }

  it('opens the page on the browser’s own origin, grouped by the order', async () => {
    await staffBrowser(`https://push.example.com/${SUFFIX}-a`);
    const order = await newOrder();
    await notifyMerchant(order.id, 'customer-cancelled');

    expect(push.sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, body] = push.sendNotification.mock.calls[0] as [{ endpoint: string }, string];
    expect(subscription.endpoint).toBe(`https://push.example.com/${SUFFIX}-a`);
    expect(JSON.parse(body)).toEqual({
      title: `Order ${order.reference} cancelled`,
      body: 'Ada cancelled their order.',
      url: `https://${store.slug}.example.com/sales/orders/${order.id}`,
      tag: `order:${order.id}`,
    });
  });

  it('forgets a browser its push service says is gone', async () => {
    const browser = await staffBrowser(`https://push.example.com/${SUFFIX}-b`);
    push.sendNotification.mockRejectedValueOnce(new push.WebPushError('Gone', 410));
    const order = await newOrder();
    await notifyMerchant(order.id, 'customer-cancelled');
    expect(await prisma.webPushSubscription.findUnique({ where: { id: browser.id } })).toBeNull();
  });
});

describe('platform staff and shoppers', () => {
  it('lists a platform alert for platform staff and emails PLATFORM_ADMIN_EMAIL', async () => {
    await notify({
      kind: 'platform.alert',
      organizationId: null,
      facts: { heading: `Job ${SUFFIX} failed`, path: '/platform/jobs' },
      email: { template: 'platform-notice', props: { subject: 'x', preview: 'x', heading: 'x', paragraphs: [], footer: 'x' } },
    });
    expect(email.sendPlatformNoticeEmail.mock.calls[0][0].to).toEqual([process.env.PLATFORM_ADMIN_EMAIL]);
    const listed = await prisma.notification.findFirst({ where: { userId: platformUserId, body: `Job ${SUFFIX} failed` } });
    expect(listed).toMatchObject({ organizationId: null, target: { type: 'platform', path: '/platform/jobs' } });
  });

  it('lists an order update for a shopper with an account, and only emails a guest', async () => {
    const shopper = await shopperWithAccount();
    const theirs = await newOrder(shopper.id);
    const guests = await newOrder();
    await notifyShopper(theirs.id, 'shipped');
    await notifyShopper(guests.id, 'shipped');

    expect(email.sendStorefrontOrderUpdateEmail.mock.calls.map(([p]) => p.to).sort()).toEqual([theirs.email, guests.email].sort());
    const listed = await prisma.notification.findMany({ where: { organizationId: store.id, kind: 'order.update' } });
    expect(listed.filter((n) => n.customerId === shopper.id)).toHaveLength(1);
    expect(listed.some((n) => (n.target as { orderId: string }).orderId === guests.id)).toBe(false);
  });
});

describe('keeping and deleting', () => {
  it('clears notifications after 90 days', async () => {
    const order = await newOrder();
    await notifyMerchant(order.id, 'customer-cancelled');
    const later = new Date(Date.now() + 91 * 86_400_000);
    const result = await runDataRetention({ now: later, only: [store.id] });
    expect(result.notificationsRemoved).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { organizationId: store.id } })).toBe(0);
    expect(await prisma.notificationEvent.count({ where: { organizationId: store.id } })).toBe(0);
  });

  it('deletes a shopper’s notifications with their account', async () => {
    const shopper = await shopperWithAccount();
    await notifyShopper((await newOrder(shopper.id)).id, 'delivered');
    expect(await prisma.notification.count({ where: { customerId: shopper.id } })).toBe(1);
    await deleteShopperAccount(store.id, shopper.id);
    expect(await prisma.notification.count({ where: { customerId: shopper.id } })).toBe(0);
  });
});
