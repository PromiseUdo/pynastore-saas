/*
 * Getting a message noticed (ROADMAP 17.4), against the real database, with
 * the email provider and Firebase stubbed.
 *
 *   - the store is emailed once per unanswered conversation, only when nobody
 *     has Messages open, and only the members who can reply;
 *   - a shopper's phone is linked to their own conversation only when they
 *     asked, inside the store's own app;
 *   - the store's reply buzzes it — once per unread stretch, never while
 *     they're looking, and never with the words of the message.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost' }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const email = vi.hoisted(() => ({ sendChatMessageAlertEmail: vi.fn(async (_payload: unknown) => {}) }));
vi.mock('@/lib/email', async (original) => ({ ...(await original<typeof import('@/lib/email')>()), ...email }));

const fcm = vi.hoisted(() => ({
  sendFcm: vi.fn(async (_token: string, _message: unknown, _data: unknown) => 'sent' as 'sent' | 'gone' | 'failed'),
  fcmConfigured: () => true,
}));
vi.mock('@/lib/mobile/push/fcm', async (original) => ({ ...(await original<typeof import('@/lib/mobile/push/fcm')>()), ...fcm }));

import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains, storefrontRequest } from './helpers/storefront-requests';
import { alertStaffAboutMessage, pushStoreReply, INBOX_WATCHING_MS } from '@/lib/chat/alerts';
import { watchChatReplies } from '@/lib/chat/push';
import { markReadByCustomer, markReadByStaff, sendCustomerMessage, sendStaffMessage, setConversationBlocked } from '@/lib/chat/service';
import { purgeOldPushWatches } from '@/lib/mobile/push/watch';
import { discardAfterTasks, flushAfterTasks } from '@/lib/run-after';
import { POST as postMessage } from '@/app/api/storefront/chat/messages/route';
import { POST as postNotify } from '@/app/api/storefront/chat/notify/route';
import { hashGuestKey, type ChatIdentity } from '@/lib/chat/identity';
import { PERMISSIONS } from '@/lib/permissions';

pinDomains();

const SUFFIX = Math.random().toString(36).slice(2, 8);
const APP = `com.chatpush${SUFFIX}.shop`;
const UA = (push = true) =>
  `Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36 MansaasApp/${APP}${push ? ' MansaasPush' : ''}`;
const TOKEN = `fcm-${'y'.repeat(140)}`;

let store = { id: '', slug: '' };
let other = { id: '', slug: '' };
let cleanup = async () => {};
let ownerEmail = '';
const users: string[] = [];

const guest = (seed: string): ChatIdentity => ({ kind: 'guest', guestKeyHash: hashGuestKey(seed.repeat(43).slice(0, 43)) });

async function shopperWrites(identity: ChatIdentity, body = 'Is this in size 43?', organizationId = store.id) {
  const sent = await sendCustomerMessage(organizationId, identity, { clientId: randomUUID(), body });
  if (!sent.ok) throw new Error(sent.message);
  return sent.conversationId;
}

async function storeReplies(conversationId: string, body = 'Yes, it is.') {
  const sent = await sendStaffMessage(store.id, { conversationId, staffUserId: users[0], clientId: randomUUID(), body });
  if (!sent.ok) throw new Error(sent.message);
  return sent.message.seq;
}

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
  return user.email;
}

beforeAll(async () => {
  const made = await createTestStores('__test-chatalert', 2);
  cleanup = made.cleanup;
  [store, other] = made.stores;
  await prisma.organization.updateMany({ where: { id: { in: [store.id, other.id] } }, data: { storefrontChatEnabled: true } });
  await prisma.mobileApp.create({ data: { organizationId: store.id, appId: APP, name: 'Chat Push' } });

  ownerEmail = await member('Owner', true, []);
  await member('Shop helper', false, [PERMISSIONS.MESSAGES_REPLY]);
  await member('Watcher', false, [PERMISSIONS.MESSAGES_VIEW]);
  await member('Former helper', false, [PERMISSIONS.MESSAGES_REPLY], 'SUSPENDED');
}, 60_000);

beforeEach(async () => {
  jar.clear();
  discardAfterTasks();
  email.sendChatMessageAlertEmail.mockClear();
  fcm.sendFcm.mockClear();
  fcm.sendFcm.mockResolvedValue('sent');
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.pushDevice.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.organization.updateMany({ where: { id: store.id }, data: { chatInboxSeenAt: null } });
});

afterAll(async () => {
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.membership.deleteMany({ where: { organizationId: store.id } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await cleanup();
}, 60_000);

describe('emailing the store', () => {
  it('emails the members who can reply, once, when nobody has Messages open', async () => {
    const id = await shopperWrites(guest('a'));
    await prisma.chatConversation.update({ where: { id }, data: { guestName: 'Sarah' } });

    expect(await alertStaffAboutMessage(store.id, id)).toBe('sent');
    expect(email.sendChatMessageAlertEmail).toHaveBeenCalledTimes(1);
    const payload = email.sendChatMessageAlertEmail.mock.calls[0][0] as unknown as {
      to: string[];
      shopperName: string;
      isGuest: boolean;
      message: string;
      conversationUrl: string;
    };
    expect(payload.to.sort()).toEqual([ownerEmail, `shophelper-ACTIVE-${SUFFIX}@example.com`].sort());
    expect(payload).toMatchObject({ shopperName: 'Sarah', isGuest: true, message: 'Is this in size 43?' });
    expect(payload.conversationUrl).toContain(`/messages?c=${id}`);
  });

  it('stays quiet while someone has Messages open', async () => {
    const id = await shopperWrites(guest('b'));
    await prisma.organization.update({ where: { id: store.id }, data: { chatInboxSeenAt: new Date(Date.now() - INBOX_WATCHING_MS / 2) } });
    expect(await alertStaffAboutMessage(store.id, id)).toBe('inbox-open');
    expect(email.sendChatMessageAlertEmail).not.toHaveBeenCalled();
  });

  it('sends one email per unanswered stretch, and another once someone has read it', async () => {
    const shopper = guest('c');
    const id = await shopperWrites(shopper, 'First');
    expect(await alertStaffAboutMessage(store.id, id)).toBe('sent');
    await shopperWrites(shopper, 'Second');
    expect(await alertStaffAboutMessage(store.id, id)).toBe('already-alerted');

    await markReadByStaff(store.id, id, 2);
    await shopperWrites(shopper, 'Third, after they read it');
    expect(await alertStaffAboutMessage(store.id, id)).toBe('sent');
    expect(email.sendChatMessageAlertEmail).toHaveBeenCalledTimes(2);
  });

  it('never sends two emails for two messages arriving together', async () => {
    const id = await shopperWrites(guest('d'));
    const outcomes = await Promise.all([alertStaffAboutMessage(store.id, id), alertStaffAboutMessage(store.id, id)]);
    expect(outcomes.sort()).toEqual(['already-alerted', 'sent']);
    expect(email.sendChatMessageAlertEmail).toHaveBeenCalledTimes(1);
  });

  it('doesn’t email about a blocked shopper', async () => {
    const id = await shopperWrites(guest('e'));
    await setConversationBlocked(store.id, id, users[0], true);
    expect(await alertStaffAboutMessage(store.id, id)).toBe('already-alerted');
    expect(email.sendChatMessageAlertEmail).not.toHaveBeenCalled();
  });

  it('quotes a long message only in part', async () => {
    const id = await shopperWrites(guest('f'), 'x'.repeat(1200));
    await alertStaffAboutMessage(store.id, id);
    const { message } = email.sendChatMessageAlertEmail.mock.calls[0][0] as unknown as { message: string };
    expect(message.length).toBeLessThanOrEqual(301);
    expect(message.endsWith('…')).toBe(true);
  });

  it('is sent after a shopper’s message through the storefront, not before it', async () => {
    const response = await postMessage(
      storefrontRequest(store.slug, '/api/storefront/chat/messages', { clientId: randomUUID(), body: 'Hello from the shop' }, { 'x-forwarded-for': '198.51.100.7' }),
    );
    expect(response.status).toBe(200);
    expect(email.sendChatMessageAlertEmail).not.toHaveBeenCalled();
    await flushAfterTasks();
    expect(email.sendChatMessageAlertEmail).toHaveBeenCalledTimes(1);
  });
});

describe('turning on reply notifications', () => {
  it('links this phone to the shopper’s own conversation, inside the store’s app', async () => {
    const shopper = guest('g');
    const id = await shopperWrites(shopper);
    expect(await watchChatReplies({ store: { slug: store.slug, organizationId: store.id }, identity: shopper, deviceToken: TOKEN, userAgent: UA() })).toBe(
      'watching',
    );
    const watches = await prisma.pushChatWatch.findMany({ where: { conversationId: id } });
    expect(watches).toHaveLength(1);
  });

  it('refuses outside a push-enabled store app, for a bad token, and before there is a conversation', async () => {
    const shopper = guest('h');
    const at = { slug: store.slug, organizationId: store.id };
    expect(await watchChatReplies({ store: at, identity: shopper, deviceToken: TOKEN, userAgent: UA() })).toBe('not-found');
    await shopperWrites(shopper);
    expect(await watchChatReplies({ store: at, identity: shopper, deviceToken: TOKEN, userAgent: UA(false) })).toBe('unavailable');
    expect(await watchChatReplies({ store: at, identity: shopper, deviceToken: TOKEN, userAgent: 'Mozilla/5.0 Chrome/129' })).toBe('unavailable');
    expect(await watchChatReplies({ store: at, identity: shopper, deviceToken: 'bad token!', userAgent: UA() })).toBe('invalid-token');
    // The app belongs to `store`, so it can't watch a chat at `other`.
    await shopperWrites(shopper, 'Elsewhere', other.id);
    expect(
      await watchChatReplies({ store: { slug: other.slug, organizationId: other.id }, identity: shopper, deviceToken: TOKEN, userAgent: UA() }),
    ).toBe('unavailable');
    expect(await prisma.pushChatWatch.count()).toBe(0);
  });

  it('works through the storefront route, finding the conversation from the shopper’s cookie', async () => {
    const send = await postMessage(
      storefrontRequest(store.slug, '/api/storefront/chat/messages', { clientId: randomUUID(), body: 'Hi' }, { 'x-forwarded-for': '198.51.100.8' }),
    );
    expect(send.status).toBe(200);
    const notify = await postNotify(storefrontRequest(store.slug, '/api/storefront/chat/notify', { deviceToken: TOKEN }, { 'user-agent': UA() }));
    expect(notify.status).toBe(200);
    expect(await prisma.pushChatWatch.count({ where: { conversation: { organizationId: store.id } } })).toBe(1);

    jar.clear();
    const stranger = await postNotify(storefrontRequest(store.slug, '/api/storefront/chat/notify', { deviceToken: TOKEN }, { 'user-agent': UA() }));
    expect(stranger.status).toBe(404);
  });
});

describe('pushing the store’s reply', () => {
  async function watchedConversation(seed: string) {
    const shopper = guest(seed);
    const id = await shopperWrites(shopper);
    await watchChatReplies({ store: { slug: store.slug, organizationId: store.id }, identity: shopper, deviceToken: TOKEN, userAgent: UA() });
    // They wrote a minute ago and closed the chat.
    await prisma.chatConversation.update({ where: { id }, data: { customerSeenAt: new Date(Date.now() - 60_000) } });
    return { id, shopper };
  }

  it('buzzes the phone with a fixed line and a link to the chat, never the message', async () => {
    const { id } = await watchedConversation('i');
    const seq = await storeReplies(id, 'Your private answer');
    const { outcome } = await pushStoreReply(store.id, id, seq);
    expect(outcome).toBe('sent');
    expect(fcm.sendFcm).toHaveBeenCalledTimes(1);
    const [token, message, data] = fcm.sendFcm.mock.calls[0] as unknown as [string, { title: string; body: string }, { path: string }];
    expect(token).toBe(TOKEN);
    expect(message.body).toBe('The store replied to your message.');
    expect(JSON.stringify(message)).not.toContain('private answer');
    expect(data.path).toBe(`/s/${store.slug}/chat`);
  });

  it('stays quiet while the shopper has the chat open', async () => {
    const { id } = await watchedConversation('j');
    await prisma.chatConversation.update({ where: { id }, data: { customerSeenAt: new Date() } });
    expect((await pushStoreReply(store.id, id, await storeReplies(id))).outcome).toBe('watching');
    expect(fcm.sendFcm).not.toHaveBeenCalled();
  });

  it('buzzes once for a burst of replies, and again after they’ve read them', async () => {
    const { id, shopper } = await watchedConversation('k');
    expect((await pushStoreReply(store.id, id, await storeReplies(id, 'One'))).outcome).toBe('sent');
    expect((await pushStoreReply(store.id, id, await storeReplies(id, 'Two'))).outcome).toBe('already-told');
    await markReadByCustomer(store.id, shopper, 3);
    await prisma.chatConversation.update({ where: { id }, data: { customerSeenAt: new Date(Date.now() - 60_000) } });
    expect((await pushStoreReply(store.id, id, await storeReplies(id, 'Three'))).outcome).toBe('sent');
    expect(fcm.sendFcm).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a shopper who didn’t ask', async () => {
    const id = await shopperWrites(guest('l'));
    expect((await pushStoreReply(store.id, id, await storeReplies(id))).outcome).toBe('no-devices');
  });

  it('forgets a phone the platform says is gone', async () => {
    const { id } = await watchedConversation('m');
    fcm.sendFcm.mockResolvedValueOnce('gone');
    await pushStoreReply(store.id, id, await storeReplies(id));
    expect(await prisma.pushDevice.count({ where: { organizationId: store.id } })).toBe(0);
    expect(await prisma.pushChatWatch.count({ where: { conversationId: id } })).toBe(0);
  });

  it('is sent after a reply from the Messages page', async () => {
    const { id } = await watchedConversation('n');
    vi.doMock('@/lib/organization', () => ({
      getOrganizationContext: async () => ({
        organization: { id: store.id, slug: store.slug, name: 'S', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
        membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: Object.values(PERMISSIONS) }, warehouseIds: [] },
        userId: users[0],
      }),
    }));
    vi.resetModules();
    const { sendReply } = await import('@/features/messages/actions');
    const { flushAfterTasks: flush } = await import('@/lib/run-after');
    const result = await sendReply({ conversationId: id, clientId: randomUUID(), body: 'Ready for pickup' });
    expect(result.success).toBe(true);
    await flush();
    expect(fcm.sendFcm).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/lib/organization');
  });
});

describe('cleaning up', () => {
  it('keeps a phone that only watches a chat, and lets it go with the conversation', async () => {
    const shopper = guest('o');
    const id = await shopperWrites(shopper);
    await watchChatReplies({ store: { slug: store.slug, organizationId: store.id }, identity: shopper, deviceToken: TOKEN, userAgent: UA() });
    await prisma.pushDevice.updateMany({ where: { organizationId: store.id }, data: { lastSeenAt: new Date('2026-01-01T00:00:00Z') } });

    await purgeOldPushWatches(new Date('2026-10-08T00:00:00Z'));
    expect(await prisma.pushDevice.count({ where: { organizationId: store.id } })).toBe(1);

    await prisma.chatConversation.delete({ where: { id } });
    expect(await prisma.pushChatWatch.count()).toBe(0);
  });
});
