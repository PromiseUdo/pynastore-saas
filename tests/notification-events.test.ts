/*
 * What each person hears about (ROADMAP 18.6), against the real database.
 *
 *   - the store hears about a new online order once, and a transfer to
 *     confirm as such;
 *   - the person who did the thing isn't told about it;
 *   - a shopper's question reaches whoever answers, and waits for the day's
 *     summary rather than an email of its own;
 *   - preferences: each person sees only what can reach them, a choice is
 *     stored only while it differs from the default, a required email
 *     can't be turned off, and a summary turned off sends nothing;
 *   - an email owners already get is in their list too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const email = vi.hoisted(() => ({ sendPlatformNoticeEmail: vi.fn(async (_payload: { to: string | string[] }) => true) }));
vi.mock('@/lib/email', async (original) => ({ ...(await original<typeof import('@/lib/email')>()), ...email }));

import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains } from './helpers/storefront-requests';
import { notify } from '@/lib/notifications/notify';
import { DIGEST_KINDS, sendDailyDigests } from '@/lib/notifications/digest';
import { latestNotifications } from '@/lib/notifications/inbox';
import { loadPreferenceGrid, savePreference } from '@/lib/notifications/preference-grid';
import { listOwnerNotice } from '@/lib/notifications/owner-notices';
import { notifyStoreOfOrder } from '@/lib/storefront/orders/notifications';
import { askQuestion } from '@/lib/storefront/questions/write';
import { discardAfterTasks, flushAfterTasks } from '@/lib/run-after';
import { PERMISSIONS } from '@/lib/permissions';

/** What the Owner holds (lib/organization.ts gives them every permission). */
const ALL_PERMISSIONS = Object.values(PERMISSIONS);

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
let shop = { id: '', slug: '' };
let cleanup = async () => {};
const users: string[] = [];
let owner = '';
let packer = '';
let writer = '';

async function member(roleName: string, isSystem: boolean, permissions: string[]) {
  const user = await prisma.user.create({ data: { email: `${roleName.toLowerCase()}-events-${SUFFIX}@example.com` } });
  users.push(user.id);
  const role = await prisma.role.create({ data: { organizationId: shop.id, name: roleName, isSystem } });
  for (const key of permissions) {
    const permission = await prisma.permission.upsert({ where: { key }, create: { key, module: key.split('.')[0] }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  await prisma.membership.create({ data: { userId: user.id, organizationId: shop.id, roleId: role.id } });
  return user.id;
}

const listed = async (userId: string) => (await latestNotifications({ kind: 'staff', userId, organizationId: shop.id }, 50)).items;

beforeAll(async () => {
  const made = await createTestStores('__test-events', 1);
  cleanup = made.cleanup;
  [shop] = made.stores;
  owner = await member('Owner', true, []);
  packer = await member('Packer', false, [PERMISSIONS.SALES_FULFILLMENT_MANAGE, PERMISSIONS.PROCUREMENT_APPROVE]);
  writer = await member('Writer', false, [PERMISSIONS.MESSAGES_REPLY]);
}, 60_000);

beforeEach(async () => {
  discardAfterTasks();
  email.sendPlatformNoticeEmail.mockClear();
  await prisma.notificationEvent.deleteMany({ where: { organizationId: shop.id } });
  await prisma.notificationPreference.deleteMany({ where: { organizationId: shop.id } });
});

afterAll(async () => {
  await prisma.notificationEvent.deleteMany({ where: { organizationId: shop.id } });
  await prisma.productQuestion.deleteMany({ where: { organizationId: shop.id } });
  await prisma.order.deleteMany({ where: { organizationId: shop.id } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: shop.id } });
  await prisma.customer.deleteMany({ where: { organizationId: shop.id } });
  await prisma.membership.deleteMany({ where: { organizationId: shop.id } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await cleanup();
}, 60_000);

describe('new online orders', () => {
  async function order() {
    return prisma.order.create({
      data: {
        organizationId: shop.id,
        reference: `EV-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        paymentMethod: 'paystack',
        subtotal: 15000,
        totalAmount: 15000,
        currency: 'NGN',
        firstName: 'Ada',
        lastName: 'Obi',
      },
    });
  }

  it('tells whoever handles orders, and the Owner, once', async () => {
    const o = await order();
    await notifyStoreOfOrder(o.id, 'paid');
    await notifyStoreOfOrder(o.id, 'paid'); // a second confirmation of the same payment

    for (const userId of [owner, packer]) {
      const items = await listed(userId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ title: `New order ${o.reference}`, href: `/sales/orders/${o.id}` });
      expect(items[0].body).toMatch(/^Ada Obi · .*15,000.* · paid online$/);
    }
    expect(await listed(writer)).toHaveLength(0);
  });

  it('asks the store to confirm a bank transfer', async () => {
    const o = await order();
    await notifyStoreOfOrder(o.id, 'transfer');
    const [item] = await listed(packer);
    expect(item.title).toBe(`Transfer to confirm: order ${o.reference}`);
  });
});

describe('who isn’t told', () => {
  it('leaves out the person who did the thing', async () => {
    await notify({
      kind: 'purchasing.approval',
      organizationId: shop.id,
      actorUserId: packer,
      facts: { purchaseOrderId: 'po1', number: 'PO-1', supplierName: 'Kano Wholesale' },
    });
    expect(await listed(packer)).toHaveLength(0);
    expect((await listed(owner)).map((i) => i.href)).toEqual(['/procurement/purchase-orders/po1']);
  });
});

describe('a shopper’s question', () => {
  it('reaches whoever answers, in the list now and the day’s summary later', async () => {
    const product = await prisma.inventoryItem.create({ data: { organizationId: shop.id, sku: `Q-${SUFFIX}`, name: 'Red Shoe' } });
    const customer = await prisma.customer.create({ data: { organizationId: shop.id, name: 'Bola', email: `bola-${SUFFIX}@example.com` } });
    const asked = await askQuestion({ organizationId: shop.id, customerId: customer.id, productId: product.id, body: 'Does it come in size 44?' });
    expect(asked.ok).toBe(true);
    await flushAfterTasks();

    expect(DIGEST_KINDS).toContain('question.new');
    const [item] = await listed(owner);
    expect(item).toMatchObject({ title: 'New question on Red Shoe', href: '/sales/questions' });
    expect(email.sendPlatformNoticeEmail).not.toHaveBeenCalled();

    await sendDailyDigests({ now: new Date(Date.now() + 60_000) });
    const toOwner = email.sendPlatformNoticeEmail.mock.calls.filter(([p]) => [p.to].flat().some((t) => t.startsWith('owner-events')));
    expect(toOwner).toHaveLength(1);
  });

  it('sends no summary to someone who turned that email off', async () => {
    await notify({ kind: 'question.new', organizationId: shop.id, facts: { productName: 'Hat', shopperName: 'Bola' } });
    await savePreference({ audience: 'staff', userId: owner, organizationId: shop.id, permissions: [...ALL_PERMISSIONS] }, 'questions', 'email', false);
    await sendDailyDigests({ now: new Date(Date.now() + 60_000) });
    expect(email.sendPlatformNoticeEmail).not.toHaveBeenCalled();
    // …and it isn't looked at again tomorrow.
    expect(await prisma.notification.count({ where: { userId: owner, kind: 'question.new', emailedAt: null } })).toBe(0);
  });
});

describe('preferences', () => {
  it('shows each person only what can reach them', async () => {
    const writerRows = await loadPreferenceGrid({ audience: 'staff', userId: writer, organizationId: shop.id, permissions: [PERMISSIONS.MESSAGES_REPLY] });
    expect(writerRows.map((r) => r.category)).toEqual(['messages']);

    const ownerRows = await loadPreferenceGrid({ audience: 'staff', userId: owner, organizationId: shop.id, permissions: [...ALL_PERMISSIONS] });
    expect(ownerRows.map((r) => r.category)).toEqual(['orders', 'messages', 'questions', 'stock', 'purchasing', 'payments', 'account', 'social']);
    expect(ownerRows.find((r) => r.category === 'account')!.email).toEqual({ kind: 'required', on: true });
    expect(ownerRows.find((r) => r.category === 'stock')!.email).toEqual({ kind: 'digest', on: true });

    const platformRows = await loadPreferenceGrid({ audience: 'platform', userId: owner });
    expect(platformRows.map((r) => r.category)).toEqual(['payments', 'merchants', 'operations']);
    expect(platformRows.every((r) => r.email === null)).toBe(true);

    const shopperRows = await loadPreferenceGrid({ audience: 'shopper', customerId: 'c1', organizationId: shop.id });
    expect(shopperRows.map((r) => r.category)).toEqual(['orders', 'messages']);
  });

  it('stores a choice only while it differs from the default, and never for a required one', async () => {
    const me = { audience: 'staff' as const, userId: packer, organizationId: shop.id, permissions: [PERMISSIONS.SALES_FULFILLMENT_MANAGE] };
    expect(await savePreference(me, 'orders', 'push', false)).toBe('saved');
    const rows = await prisma.notificationPreference.findMany({ where: { userId: packer, category: 'orders' }, select: { channel: true, enabled: true } });
    expect(rows.sort((a, b) => a.channel.localeCompare(b.channel))).toEqual([
      { channel: 'NATIVE_PUSH', enabled: false },
      { channel: 'WEB_PUSH', enabled: false },
    ]);
    expect((await loadPreferenceGrid(me)).find((r) => r.category === 'orders')!.push).toEqual({ kind: 'choice', on: false });

    expect(await savePreference(me, 'orders', 'push', true)).toBe('saved');
    expect(await prisma.notificationPreference.count({ where: { userId: packer } })).toBe(0);

    expect(await savePreference(me, 'stock', 'email', false)).toBe('not-yours');
    const asOwner = { ...me, userId: owner, permissions: [...ALL_PERMISSIONS] };
    expect(await savePreference(asOwner, 'account', 'email', false)).toBe('required');
  });
});

describe('what owners already get by email', () => {
  it('is in their list too, leading to the page it’s about', async () => {
    await listOwnerNotice(shop.id, { heading: 'Your trial ends in 3 days', paragraphs: ['Choose a plan to keep the shop open.'] }, '/upgrade', `t:${SUFFIX}`);
    const [item] = await listed(owner);
    expect(item).toMatchObject({ title: 'Your trial ends in 3 days', body: 'Choose a plan to keep the shop open.', href: '/upgrade' });
    expect(await listed(writer)).toHaveLength(0);
  });
});
