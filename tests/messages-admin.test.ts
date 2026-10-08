/*
 * Messages, the merchant's side (ROADMAP 17.2), against the real database:
 * the reply/resolve/block actions, the feed route the page and the sidebar
 * poll, and the chat switch in Settings → Storefront.
 *
 * What matters most: the store always comes from the member's session, so
 * another store's conversation id is a miss; replying needs its own
 * permission; and every status change is on the record.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ALL = Object.values(PERMISSIONS) as string[];
const ctx = {
  organization: { id: '', name: 'Messages Admin', slug: '', logoUrl: null, status: 'ACTIVE', currency: 'NGN' },
  membership: { id: 'm', role: { id: 'r', name: 'Admin', isSystem: true, permissions: ALL }, warehouseIds: [] as string[] },
  userId: '',
};
let accessState: 'active' | 'lapsed' = 'active';

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));
vi.mock('@/lib/billing/entitlements', () => ({
  getOrganizationEntitlements: async () => ({ access: { state: accessState } }),
}));

const actions = await import('@/features/messages/actions');
const { saveStorefrontChat, getStorefrontAppearance } = await import('@/features/settings/storefront');
const { POST: feed } = await import('@/app/(dashboard)/[organizationSlug]/messages/feed/route');
const { sendCustomerMessage, inboxSummary, chatProductCards, chatSetup } = await import('@/lib/chat/service');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let storeId = '';
let otherId = '';
let ada = '';
let productId = '';
let foreignProductId = '';

function as(permissions: string[]) {
  ctx.membership.role.permissions = permissions;
}

async function adaWrites(body: string, productIdArg?: string, organizationId = storeId, customerId = ada) {
  const sent = await sendCustomerMessage(organizationId, { kind: 'customer', customerId }, { clientId: randomUUID(), body, productId: productIdArg });
  if (!sent.ok) throw new Error(sent.message);
  return sent.conversationId;
}

const post = (body: unknown, contentType = 'application/json') =>
  feed(new Request('http://acme.localhost/messages/feed', { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body) }));

beforeAll(async () => {
  storeId = (await prisma.organization.create({ data: { name: 'Messages Admin', slug: `__test-msgadmin-${suffix}`, storefrontChatEnabled: true } })).id;
  otherId = (await prisma.organization.create({ data: { name: 'Elsewhere', slug: `__test-msgadmin-other-${suffix}`, storefrontChatEnabled: true } })).id;
  ctx.organization.id = storeId;
  ctx.organization.slug = `__test-msgadmin-${suffix}`;
  ctx.userId = (await prisma.user.create({ data: { email: `msgadmin-${suffix}@example.com`, name: 'Kemi' } })).id;
  ada = (await prisma.customer.create({ data: { organizationId: storeId, name: 'Ada Okafor', email: `ada-msgadmin-${suffix}@example.com` } })).id;
  productId = (
    await prisma.inventoryItem.create({
      data: { organizationId: storeId, name: 'Air Max', sku: `AMX-${suffix}`.slice(0, 40), slug: `air-max-x-${suffix}`, sellingPrice: 85000 },
    })
  ).id;
  foreignProductId = (
    await prisma.inventoryItem.create({
      data: { organizationId: otherId, name: 'Theirs', sku: `TH-${suffix}`.slice(0, 40), slug: `theirs-${suffix}`, sellingPrice: 10 },
    })
  ).id;
});

beforeEach(async () => {
  as(ALL);
  accessState = 'active';
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [storeId, otherId] } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: storeId } });
  await prisma.organization.updateMany({ where: { id: { in: [storeId, otherId] } }, data: { storefrontChatEnabled: true, storefrontChatGreeting: null } });
});

afterAll(async () => {
  for (const id of [storeId, otherId]) {
    await prisma.chatConversation.deleteMany({ where: { organizationId: id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: id } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: id } });
    await prisma.customer.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  }
  await prisma.user.delete({ where: { id: ctx.userId } });
});

describe('replying', () => {
  it('sends a reply as the member, and the shopper’s unread count goes up', async () => {
    const id = await adaWrites('Is this in size 43?');
    const result = await actions.sendReply({ conversationId: id, clientId: randomUUID(), body: 'Yes, it is.' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.message).toMatchObject({ sender: 'STAFF', staffUserId: ctx.userId, staffName: 'Kemi', seq: 2 });
    expect(await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ customerReadSeq: 1, staffReadSeq: 2 });
  });

  it('needs messages.reply — viewing isn’t enough', async () => {
    const id = await adaWrites('Hello');
    as([PERMISSIONS.MESSAGES_VIEW]);
    const result = await actions.sendReply({ conversationId: id, clientId: randomUUID(), body: 'Hi' });
    expect(result).toEqual({ success: false, error: 'You don’t have permission to reply to messages' });
    expect(await prisma.chatMessage.count({ where: { conversationId: id } })).toBe(1);
  });

  it('can’t reach another store’s conversation', async () => {
    const theirs = await adaWrites('Not yours', undefined, otherId, (await prisma.customer.create({ data: { organizationId: otherId, name: 'Bola', email: `bola-${suffix}@example.com` } })).id);
    const result = await actions.sendReply({ conversationId: theirs, clientId: randomUUID(), body: 'Peek' });
    expect(result).toMatchObject({ success: false });
    expect(await actions.resolveConversation(theirs)).toEqual({ success: false, error: 'That conversation no longer exists' });
    expect(await actions.blockConversation(theirs)).toMatchObject({ success: false });
    expect(await prisma.chatConversation.findUniqueOrThrow({ where: { id: theirs } })).toMatchObject({ status: 'OPEN', blockedAt: null, lastSeq: 1 });
  });

  it('refuses an empty reply with a message to show', async () => {
    const id = await adaWrites('Hello');
    expect(await actions.sendReply({ conversationId: id, clientId: randomUUID(), body: '   ' })).toEqual({ success: false, error: 'Write a message first.' });
  });
});

describe('resolving and blocking', () => {
  it('resolves, reopens, blocks and unblocks — each on the activity log', async () => {
    const id = await adaWrites('Hello');
    for (const action of [actions.resolveConversation, actions.reopenConversation, actions.blockConversation, actions.unblockConversation]) {
      expect(await action(id)).toEqual({ success: true, data: undefined });
    }
    const logged = await prisma.auditLog.findMany({ where: { organizationId: storeId, entityId: id }, orderBy: { createdAt: 'asc' }, select: { action: true, userId: true, entityType: true } });
    expect(logged.map((l) => l.action)).toEqual([
      'messages.conversation.resolved',
      'messages.conversation.reopened',
      'messages.conversation.blocked',
      'messages.conversation.unblocked',
    ]);
    expect(logged.every((l) => l.userId === ctx.userId && l.entityType === 'ChatConversation')).toBe(true);
  });

  it('needs messages.reply', async () => {
    const id = await adaWrites('Hello');
    as([PERMISSIONS.MESSAGES_VIEW]);
    expect((await actions.resolveConversation(id)).success).toBe(false);
    expect((await actions.blockConversation(id)).success).toBe(false);
    expect(await prisma.auditLog.count({ where: { organizationId: storeId } })).toBe(0);
  });
});

describe('the feed', () => {
  it('answers a bare poll with the inbox summary', async () => {
    await adaWrites('Hello');
    const response = await post({});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.summary).toMatchObject({ unreadConversations: 1, latestUnread: { name: 'Ada Okafor' } });
    expect(body.messages).toBeUndefined();
  });

  it('returns only what’s newer than the browser holds, with product cards', async () => {
    const id = await adaWrites('First');
    await adaWrites('About this one', productId);
    const body = await (await post({ conversationId: id, after: 1 })).json();
    expect(body.messages.map((m: { seq: number }) => m.seq)).toEqual([2]);
    expect(body.products[productId]).toMatchObject({ name: 'Air Max', price: 85000 });
    expect(body.lastSeq).toBe(2);
  });

  it('pages backwards for “Load earlier”', async () => {
    const id = await adaWrites('One');
    for (const word of ['Two', 'Three']) await adaWrites(word);
    const body = await (await post({ conversationId: id, before: 3 })).json();
    expect(body.messages.map((m: { body: string }) => m.body)).toEqual(['One', 'Two']);
    expect(body.hasEarlier).toBe(false);
  });

  it('marks read what was shown — but only for someone who can reply', async () => {
    const id = await adaWrites('One');
    await adaWrites('Two');

    as([PERMISSIONS.MESSAGES_VIEW]);
    await post({ conversationId: id, after: 2, read: 2 });
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).staffReadSeq).toBe(0);

    as(ALL);
    const body = await (await post({ conversationId: id, after: 2, read: 2 })).json();
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).staffReadSeq).toBe(2);
    expect(body.summary.unreadConversations).toBe(0);
  });

  it('tells the store someone has Messages open only when the page says so', async () => {
    await post({});
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: storeId } })).chatInboxSeenAt).toBeNull();
    await post({ inbox: true });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: storeId } })).chatInboxSeenAt).not.toBeNull();
    await prisma.organization.update({ where: { id: storeId }, data: { chatInboxSeenAt: null } });
  });

  it('says a conversation is missing rather than leaking another store’s', async () => {
    const bola = (await prisma.customer.findFirst({ where: { organizationId: otherId } }))?.id
      ?? (await prisma.customer.create({ data: { organizationId: otherId, name: 'Bola', email: `bola2-${suffix}@example.com` } })).id;
    const theirs = await adaWrites('Secret', undefined, otherId, bola);
    const body = await (await post({ conversationId: theirs, after: 0, read: 1 })).json();
    expect(body.missing).toBe(true);
    expect(body.messages).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('Secret');
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: theirs } })).staffReadSeq).toBe(0);
  });

  it('treats an out-of-range position as nothing newer, not a server error', async () => {
    const id = await adaWrites('Hello');
    const response = await post({ conversationId: id, after: 2 ** 40, read: 2 ** 40 });
    expect(response.status).toBe(200);
    expect((await response.json()).messages.map((m: { seq: number }) => m.seq)).toEqual([1]);
  });

  it('refuses without messages.view, when the plan has ended, and for anything but JSON', async () => {
    as([PERMISSIONS.SALES_VIEW]);
    expect((await post({})).status).toBe(403);
    as(ALL);
    accessState = 'lapsed';
    expect((await post({})).status).toBe(403);
    accessState = 'active';
    expect((await post({}, 'text/plain')).status).toBe(415);
  });
});

describe('the inbox summary and product cards', () => {
  it('names the newest unread conversation, and drops it once read', async () => {
    const id = await adaWrites('Hello');
    expect((await inboxSummary(storeId)).latestUnread).toMatchObject({ id, name: 'Ada Okafor' });
    await post({ conversationId: id, after: 1, read: 1 });
    expect((await inboxSummary(storeId)).latestUnread).toBeNull();
  });

  it('shows only this store’s products', async () => {
    const cards = await chatProductCards(storeId, [productId, foreignProductId, null, productId]);
    expect(Object.keys(cards)).toEqual([productId]);
  });
});

describe('the chat switch', () => {
  it('turns chat on with a greeting, and logs it', async () => {
    await prisma.organization.update({ where: { id: storeId }, data: { storefrontChatEnabled: false } });
    expect(await saveStorefrontChat({ enabled: true, greeting: '  Hi! Ask us anything.  ' })).toEqual({ success: true, data: undefined });
    expect(await chatSetup(storeId)).toMatchObject({ enabled: true });
    const settings = await getStorefrontAppearance();
    expect(settings.success && settings.data.chat).toEqual({ enabled: true, greeting: 'Hi! Ask us anything.' });
    expect(await prisma.auditLog.count({ where: { organizationId: storeId, action: 'settings.storefront.chat_updated' } })).toBe(1);
  });

  it('stores an empty greeting as none, so the chat uses its own line', async () => {
    await saveStorefrontChat({ enabled: true, greeting: '   ' });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: storeId } })).storefrontChatGreeting).toBeNull();
  });

  it('refuses a greeting that’s too long, and anyone without settings.edit', async () => {
    expect((await saveStorefrontChat({ enabled: true, greeting: 'x'.repeat(201) })).success).toBe(false);
    as([PERMISSIONS.SETTINGS_VIEW]);
    expect(await saveStorefrontChat({ enabled: false, greeting: '' })).toMatchObject({ success: false });
    expect((await chatSetup(storeId)).enabled).toBe(true);
  });
});
