/*
 * Messages (ROADMAP 17.1), against the real database.
 *
 * What the feature rests on: a conversation belongs to one store and one
 * shopper, and nobody else can reach it — not another store's staff, not
 * another shopper, not a guessed id. Then the things a chat gets wrong under
 * load: numbering when sends collide, a retried send saving twice, and the
 * read marks moving backwards.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* An in-memory cookie jar standing in for the request's cookies. */
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost' }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

import { prisma } from '@/lib/prisma';
import { signSessionToken, sessionCookieName } from '@/lib/storefront/account/session';
import { chatGuestCookieName, chatIdentityForSending, currentChatIdentity, currentGuestKeyHash, hashGuestKey, type ChatIdentity } from '@/lib/chat/identity';
import {
  adoptGuestConversation,
  chatAvailability,
  getConversationForStaff,
  getShopperChat,
  inboxSummary,
  listConversations,
  listStaffMessages,
  markReadByCustomer,
  markReadByStaff,
  sendCustomerMessage,
  sendStaffMessage,
  setConversationBlocked,
  setConversationResolved,
  touchInboxSeen,
} from '@/lib/chat/service';
import { MESSAGE_PAGE_SIZE } from '@/lib/chat/rules';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { getPermissionLabel } from '@/lib/permission-labels';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-chat-${suffix}` };
const other = { id: '', slug: `__test-chat-other-${suffix}` };

let ada = ''; // a signed-in shopper of `store`
let tunde = ''; // another shopper of `store`
let staffId = '';
let productId = '';
let foreignProductId = '';

const asCustomer = (customerId: string): ChatIdentity => ({ kind: 'customer', customerId });
const asGuest = (key: string): ChatIdentity => ({ kind: 'guest', guestKeyHash: hashGuestKey(key) });

const say = (identity: ChatIdentity, body: string, extra: Record<string, unknown> = {}, organizationId = store.id) =>
  sendCustomerMessage(organizationId, identity, { clientId: randomUUID(), body, ...extra });

async function conversationOf(identity: ChatIdentity) {
  const chat = await getShopperChat(store.id, identity);
  if (!chat.conversation) throw new Error('no conversation');
  return chat.conversation.id;
}

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Chat Store', slug: store.slug, storefrontChatEnabled: true } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug, storefrontChatEnabled: true } })).id;

  ada = (await prisma.customer.create({ data: { organizationId: store.id, name: 'Ada Okafor', email: `ada-chat-${suffix}@example.com` } })).id;
  tunde = (await prisma.customer.create({ data: { organizationId: store.id, name: 'Tunde Bello', email: `tunde-chat-${suffix}@example.com` } })).id;
  staffId = (await prisma.user.create({ data: { email: `staff-chat-${suffix}@example.com`, name: 'Kemi from the shop' } })).id;

  productId = (
    await prisma.inventoryItem.create({
      data: { organizationId: store.id, name: 'Air Max', sku: `AM-${suffix}`.slice(0, 40), slug: `air-max-${suffix}`, sellingPrice: 85000 },
    })
  ).id;
  foreignProductId = (
    await prisma.inventoryItem.create({
      data: { organizationId: other.id, name: 'Foreign', sku: `FX-${suffix}`.slice(0, 40), slug: `foreign-${suffix}`, sellingPrice: 100 },
    })
  ).id;
});

beforeEach(async () => {
  jar.clear();
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.organization.updateMany({
    where: { id: { in: [store.id, other.id] } },
    data: { storefrontChatEnabled: true, storefrontOpen: true, chatInboxSeenAt: null },
  });
});

afterAll(async () => {
  for (const org of [store, other]) {
    await prisma.chatConversation.deleteMany({ where: { organizationId: org.id } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
  await prisma.user.delete({ where: { id: staffId } });
});

describe('starting a conversation', () => {
  it('creates nothing until the first message is sent', async () => {
    expect(await getShopperChat(store.id, asCustomer(ada))).toEqual({ conversation: null, messages: [], hasEarlier: false });
    expect(await getShopperChat(store.id, null)).toMatchObject({ conversation: null });
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id } })).toBe(0);
  });

  it('creates the conversation in this store on the first message', async () => {
    const sent = await say(asCustomer(ada), 'Is this shoe available in size 43?');
    expect(sent.ok).toBe(true);

    const row = await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } });
    expect(row).toMatchObject({
      customerId: ada,
      guestKeyHash: null,
      status: 'OPEN',
      lastSeq: 1,
      lastSender: 'CUSTOMER',
      lastPreview: 'Is this shoe available in size 43?',
      customerReadSeq: 1,
      staffReadSeq: 0,
    });
  });

  it('keeps one conversation per shopper per store', async () => {
    await say(asCustomer(ada), 'First');
    await say(asCustomer(ada), 'Second');
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id, customerId: ada } })).toBe(1);
  });

  it('refuses an empty or oversized message and saves nothing', async () => {
    expect(await say(asCustomer(ada), '   ')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await say(asCustomer(ada), 'x'.repeat(2001))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await sendCustomerMessage(store.id, asCustomer(ada), { clientId: 'no', body: 'hello' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id } })).toBe(0);
  });

  it('refuses when chat is off or the shop is closed', async () => {
    await prisma.organization.update({ where: { id: store.id }, data: { storefrontChatEnabled: false } });
    expect(await say(asCustomer(ada), 'Hello?')).toMatchObject({ ok: false, code: 'unavailable' });
    expect((await chatAvailability(store.id)).open).toBe(false);

    await prisma.organization.update({ where: { id: store.id }, data: { storefrontChatEnabled: true, storefrontOpen: false } });
    expect(await say(asCustomer(ada), 'Hello?')).toMatchObject({ ok: false, code: 'unavailable' });

    await prisma.organization.update({ where: { id: store.id }, data: { storefrontOpen: true } });
    expect((await chatAvailability(store.id)).open).toBe(true);
  });

  it('keeps this store’s product as context, and drops another store’s', async () => {
    await say(asCustomer(ada), 'About this one', { productId });
    await say(asCustomer(ada), 'And this one', { productId: foreignProductId });
    const messages = await prisma.chatMessage.findMany({ where: { organizationId: store.id }, orderBy: { seq: 'asc' } });
    expect(messages.map((m) => m.productId)).toEqual([productId, null]);
  });
});

describe('tenancy', () => {
  it('never shows one store’s conversation to another store', async () => {
    await say(asCustomer(ada), 'Private question');
    const id = await conversationOf(asCustomer(ada));

    expect(await getConversationForStaff(other.id, id, { contact: true, orders: true })).toBeNull();
    expect(await listStaffMessages(other.id, id)).toBeNull();
    expect((await listConversations(other.id)).total).toBe(0);
    expect((await inboxSummary(other.id)).unreadConversations).toBe(0);
  });

  it('refuses another store’s staff replying, resolving or blocking', async () => {
    await say(asCustomer(ada), 'Hello');
    const id = await conversationOf(asCustomer(ada));

    expect(await sendStaffMessage(other.id, { conversationId: id, staffUserId: staffId, clientId: randomUUID(), body: 'Gotcha' })).toMatchObject({
      ok: false,
      code: 'not-found',
    });
    expect(await setConversationResolved(other.id, id, staffId, true)).toBe(false);
    expect(await setConversationBlocked(other.id, id, staffId, true)).toBe(false);
    await markReadByStaff(other.id, id, 99);

    const row = await prisma.chatConversation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ lastSeq: 1, status: 'OPEN', blockedAt: null, staffReadSeq: 0 });
  });

  it('gives each shopper only their own conversation', async () => {
    await say(asCustomer(ada), 'Ada’s message');
    expect((await getShopperChat(store.id, asCustomer(tunde))).conversation).toBeNull();
    expect((await getShopperChat(store.id, asGuest('x'.repeat(43)))).conversation).toBeNull();
  });

  it('keeps the same shopper’s conversations with two stores apart', async () => {
    const guest = asGuest('g'.repeat(43));
    await say(guest, 'To the first store');
    await say(guest, 'To the second store', {}, other.id);
    const mine = await getShopperChat(store.id, guest);
    const theirs = await getShopperChat(other.id, guest);
    expect(mine.messages.map((m) => m.body)).toEqual(['To the first store']);
    expect(theirs.messages.map((m) => m.body)).toEqual(['To the second store']);
  });
});

describe('ordering and double sends', () => {
  it('numbers messages without gaps when many are sent at once', async () => {
    await say(asCustomer(ada), 'Opening line');
    const id = await conversationOf(asCustomer(ada));

    await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => say(asCustomer(ada), `Shopper ${i}`)),
      ...Array.from({ length: 6 }, (_, i) =>
        sendStaffMessage(store.id, { conversationId: id, staffUserId: staffId, clientId: randomUUID(), body: `Staff ${i}` }),
      ),
    ]);

    const seqs = (await prisma.chatMessage.findMany({ where: { conversationId: id }, orderBy: { seq: 'asc' }, select: { seq: true } })).map((m) => m.seq);
    expect(seqs).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).lastSeq).toBe(13);
  });

  it('creates one conversation when a new shopper’s first messages collide', async () => {
    const guest = asGuest('c'.repeat(43));
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => say(guest, `Hello ${i}`)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id } })).toBe(1);
    expect((await getShopperChat(store.id, guest)).messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it('saves a retried send once and returns the saved message', async () => {
    const clientId = randomUUID();
    const first = await sendCustomerMessage(store.id, asCustomer(ada), { clientId, body: 'Only once please' });
    const again = await sendCustomerMessage(store.id, asCustomer(ada), { clientId, body: 'Only once please' });
    const racing = await Promise.all([1, 2, 3].map(() => sendCustomerMessage(store.id, asCustomer(ada), { clientId, body: 'Only once please' })));

    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.message.id).toBe(first.message.id);
    for (const r of racing) expect(r.ok && r.message.id).toBe(first.message.id);
    expect(await prisma.chatMessage.count({ where: { organizationId: store.id } })).toBe(1);
    expect((await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } })).lastSeq).toBe(1);
  });

  it('saves a retried staff reply once', async () => {
    await say(asCustomer(ada), 'Hello');
    const id = await conversationOf(asCustomer(ada));
    const clientId = randomUUID();
    const reply = { conversationId: id, staffUserId: staffId, clientId, body: 'Hi Ada!' };
    const [a, b] = await Promise.all([sendStaffMessage(store.id, reply), sendStaffMessage(store.id, reply)]);
    expect(a.ok && b.ok && a.message.id === b.message.id).toBe(true);
    expect(await prisma.chatMessage.count({ where: { conversationId: id, sender: 'STAFF' } })).toBe(1);
  });
});

describe('reading a conversation', () => {
  it('pages the latest messages first, then earlier ones, oldest first within a page', async () => {
    const total = MESSAGE_PAGE_SIZE + 5;
    for (let i = 1; i <= total; i++) await say(asCustomer(ada), `Message ${i}`);

    const latest = await getShopperChat(store.id, asCustomer(ada));
    expect(latest.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(latest.messages[0].seq).toBe(6);
    expect(latest.messages.at(-1)?.seq).toBe(total);
    expect(latest.hasEarlier).toBe(true);

    const earlier = await getShopperChat(store.id, asCustomer(ada), { before: 6 });
    expect(earlier.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(earlier.hasEarlier).toBe(false);

    const poll = await getShopperChat(store.id, asCustomer(ada), { after: total - 2 });
    expect(poll.messages.map((m) => m.seq)).toEqual([total - 1, total]);
    expect(poll.hasEarlier).toBeNull();
  });

  it('shows shoppers “Store team”, never the staff member', async () => {
    await say(asCustomer(ada), 'Hello');
    const id = await conversationOf(asCustomer(ada));
    await sendStaffMessage(store.id, { conversationId: id, staffUserId: staffId, clientId: randomUUID(), body: 'Yes, size 43 is available.' });

    const shopperView = await getShopperChat(store.id, asCustomer(ada));
    const reply = shopperView.messages.at(-1)!;
    expect(reply).toMatchObject({ sender: 'STAFF', author: 'Store team', body: 'Yes, size 43 is available.' });
    expect(JSON.stringify(shopperView)).not.toContain('Kemi');
    expect(JSON.stringify(shopperView)).not.toContain(staffId);

    const staffView = await listStaffMessages(store.id, id);
    expect(staffView?.messages.at(-1)).toMatchObject({ staffUserId: staffId, staffName: 'Kemi from the shop' });
  });
});

describe('read state', () => {
  it('makes a shopper’s message unread for the store until someone reads it', async () => {
    await say(asCustomer(ada), 'One');
    await say(asCustomer(ada), 'Two');
    await say(asCustomer(tunde), 'Hi');
    const adaChat = await conversationOf(asCustomer(ada));

    expect((await inboxSummary(store.id)).unreadConversations).toBe(2);
    expect((await listConversations(store.id)).rows.find((r) => r.id === adaChat)?.unread).toBe(2);

    await markReadByStaff(store.id, adaChat, 2);
    expect((await inboxSummary(store.id)).unreadConversations).toBe(1);
    expect((await listConversations(store.id)).rows.find((r) => r.id === adaChat)?.unread).toBe(0);
  });

  it('marks only what was on screen, never past the end, never backwards', async () => {
    for (const body of ['a', 'b', 'c']) await say(asCustomer(ada), body);
    const id = await conversationOf(asCustomer(ada));

    await markReadByStaff(store.id, id, 2);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).staffReadSeq).toBe(2);
    await markReadByStaff(store.id, id, 1);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).staffReadSeq).toBe(2);
    await markReadByStaff(store.id, id, 500);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).staffReadSeq).toBe(3);
  });

  it('counts a store reply as read by the store and unread by the shopper', async () => {
    await say(asCustomer(ada), 'Hello');
    const id = await conversationOf(asCustomer(ada));
    await sendStaffMessage(store.id, { conversationId: id, staffUserId: staffId, clientId: randomUUID(), body: 'Hi!' });

    expect((await inboxSummary(store.id)).unreadConversations).toBe(0);
    expect((await getShopperChat(store.id, asCustomer(ada))).conversation?.unread).toBe(1);

    await markReadByCustomer(store.id, asCustomer(ada), 2);
    expect((await getShopperChat(store.id, asCustomer(ada))).conversation?.unread).toBe(0);
  });

  it('clears the unanswered-email mark when the store reads it', async () => {
    await say(asCustomer(ada), 'Hello');
    const id = await conversationOf(asCustomer(ada));
    await prisma.chatConversation.update({ where: { id }, data: { staffAlertedAt: new Date() } });
    await markReadByStaff(store.id, id, 1);
    expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).staffAlertedAt).toBeNull();
  });

  it('notes the inbox is open at most once a minute', async () => {
    const t0 = new Date('2026-10-07T10:00:00Z');
    await touchInboxSeen(store.id, t0);
    await touchInboxSeen(store.id, new Date(t0.getTime() + 30_000));
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: store.id } })).chatInboxSeenAt).toEqual(t0);
    const t1 = new Date(t0.getTime() + 61_000);
    await touchInboxSeen(store.id, t1);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: store.id } })).chatInboxSeenAt).toEqual(t1);
  });
});

describe('resolving and blocking', () => {
  it('reopens a resolved conversation when the shopper writes again', async () => {
    await say(asCustomer(ada), 'Do you deliver to Port Harcourt?');
    const id = await conversationOf(asCustomer(ada));
    expect(await setConversationResolved(store.id, id, staffId, true)).toBe(true);
    expect(await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'RESOLVED', resolvedByUserId: staffId });

    // the history stays visible to the shopper while resolved
    expect((await getShopperChat(store.id, asCustomer(ada))).messages).toHaveLength(1);

    await say(asCustomer(ada), 'One more thing…');
    expect(await prisma.chatConversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'OPEN', resolvedAt: null, resolvedByUserId: null });
  });

  it('filters the inbox by awaiting reply and resolved', async () => {
    await say(asCustomer(ada), 'Waiting on you');
    await say(asCustomer(tunde), 'Already handled');
    const tundeChat = await conversationOf(asCustomer(tunde));
    await setConversationResolved(store.id, tundeChat, staffId, true);

    expect((await listConversations(store.id, { view: 'awaiting' })).rows.map((r) => r.name)).toEqual(['Ada Okafor']);
    expect((await listConversations(store.id, { view: 'resolved' })).rows.map((r) => r.name)).toEqual(['Tunde Bello']);
    expect((await listConversations(store.id, { view: 'all' })).total).toBe(2);
  });

  it('searches names, emails, guest names and message text, inside this store', async () => {
    await say(asCustomer(ada), 'Is the blue one in stock?');
    await say(asGuest('s'.repeat(43)), 'Do you deliver to Abuja?', { guestName: 'Chidi' });
    await say(asCustomer(tunde), 'blue please', {}, store.id);
    await say(asGuest('o'.repeat(43)), 'blue in the other store', {}, other.id);

    const names = async (q: string) => (await listConversations(store.id, { q })).rows.map((r) => r.name).sort();
    expect(await names('BLUE')).toEqual(['Ada Okafor', 'Tunde Bello']);
    expect(await names('chidi')).toEqual(['Chidi']);
    expect(await names(`ada-chat-${suffix}`)).toEqual(['Ada Okafor']);
    expect(await names('nothing like this')).toEqual([]);
  });

  it('stops a blocked shopper sending, keeps the history, and lets the store still reply', async () => {
    await say(asCustomer(ada), 'Spam spam spam');
    const id = await conversationOf(asCustomer(ada));
    await setConversationBlocked(store.id, id, staffId, true);

    expect(await say(asCustomer(ada), 'More spam')).toMatchObject({ ok: false, code: 'blocked' });
    expect(await prisma.chatMessage.count({ where: { conversationId: id } })).toBe(1);
    expect((await getShopperChat(store.id, asCustomer(ada))).conversation).toMatchObject({ blocked: true });
    expect((await inboxSummary(store.id)).unreadConversations).toBe(0);

    const reply = await sendStaffMessage(store.id, { conversationId: id, staffUserId: staffId, clientId: randomUUID(), body: 'Please stop.' });
    expect(reply.ok).toBe(true);

    await setConversationBlocked(store.id, id, staffId, false);
    expect((await say(asCustomer(ada), 'Sorry')).ok).toBe(true);
  });
});

describe('the customer panel', () => {
  it('shows contact details and orders only when the member may see them', async () => {
    await say(asCustomer(ada), 'About this one', { productId });
    const id = await conversationOf(asCustomer(ada));

    const full = await getConversationForStaff(store.id, id, { contact: true, orders: true });
    expect(full).toMatchObject({ name: 'Ada Okafor', isGuest: false, latestProductId: productId });
    expect(full?.customer).toMatchObject({ email: `ada-chat-${suffix}@example.com`, orderCount: 0 });

    const limited = await getConversationForStaff(store.id, id, { contact: false, orders: false });
    expect(limited?.customer).toMatchObject({ email: null, orderCount: null });
  });

  it('shows a guest as a guest, with the name they chose if any', async () => {
    await say(asGuest('n'.repeat(43)), 'Hello', { guestName: '  Sarah  ' });
    await say(asGuest('u'.repeat(43)), 'Hi');
    const rows = (await listConversations(store.id)).rows;
    expect(rows.map((r) => [r.name, r.isGuest]).sort()).toEqual([
      ['Sarah', true],
      [null, true],
    ].sort());
  });
});

describe('who is chatting', () => {
  it('makes a guest only when a message is sent, and remembers them', async () => {
    const at = { slug: store.slug, organizationId: store.id };
    expect(await currentChatIdentity(at)).toBeNull();
    expect(jar.size).toBe(0);

    const first = await chatIdentityForSending(at);
    expect(first.kind).toBe('guest');
    expect(jar.has(chatGuestCookieName(store.slug))).toBe(true);

    const again = await chatIdentityForSending(at);
    expect(again).toEqual(first);
    expect(await currentChatIdentity(at)).toEqual(first);
    // only the hash is ever stored
    const key = jar.get(chatGuestCookieName(store.slug))!;
    expect(first).toEqual({ kind: 'guest', guestKeyHash: hashGuestKey(key) });
  });

  it('ignores a guest cookie that isn’t one of ours', async () => {
    jar.set(chatGuestCookieName(store.slug), 'not-a-key');
    expect(await currentChatIdentity({ slug: store.slug, organizationId: store.id })).toBeNull();
  });

  it('treats a signed-in shopper as their account, and never as another store’s', async () => {
    jar.set(chatGuestCookieName(store.slug), 'k'.repeat(43));
    jar.set(sessionCookieName(store.slug), await signSessionToken({ customerId: ada, organizationId: store.id, slug: store.slug, sessionVersion: 0 }));

    expect(await currentChatIdentity({ slug: store.slug, organizationId: store.id })).toEqual(asCustomer(ada));
    // the same browser on another store is nobody there
    expect(await currentChatIdentity({ slug: other.slug, organizationId: other.id })).toBeNull();
  });

  it('gives a guest’s conversation to the account they sign in to', async () => {
    jar.set(chatGuestCookieName(store.slug), 'a'.repeat(43));
    const guestHash = (await currentGuestKeyHash(store.slug))!;
    await say({ kind: 'guest', guestKeyHash: guestHash }, 'Asked before signing in', { guestName: 'Ada' });

    expect(await adoptGuestConversation(store.id, guestHash, ada)).toBe(true);
    const chat = await getShopperChat(store.id, asCustomer(ada));
    expect(chat.messages.map((m) => m.body)).toEqual(['Asked before signing in']);
    expect(await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } })).toMatchObject({
      customerId: ada,
      guestKeyHash: null,
      guestName: null,
    });
  });

  it('leaves a guest conversation alone when the account already has one', async () => {
    await say(asCustomer(ada), 'From my account');
    const guest = asGuest('b'.repeat(43));
    await say(guest, 'As a guest');
    expect(await adoptGuestConversation(store.id, hashGuestKey('b'.repeat(43)), ada)).toBe(false);
    expect((await getShopperChat(store.id, guest)).messages.map((m) => m.body)).toEqual(['As a guest']);
  });

  it('does not adopt across stores', async () => {
    const guestHash = hashGuestKey('d'.repeat(43));
    await say({ kind: 'guest', guestKeyHash: guestHash }, 'Other store', {}, other.id);
    expect(await adoptGuestConversation(store.id, guestHash, ada)).toBe(false);
  });
});

describe('permissions', () => {
  it('defines the two Messages permissions with labels', () => {
    expect(PERMISSIONS.MESSAGES_VIEW).toBe('messages.view');
    expect(PERMISSIONS.MESSAGES_REPLY).toBe('messages.reply');
    expect(getPermissionLabel('messages.view')).not.toBe('messages.view');
    expect(getPermissionLabel('messages.reply')).not.toBe('messages.reply');
  });

  it('gives them to Owner and Admin, and nobody else by default', () => {
    expect(SYSTEM_ROLES.OWNER.permissions).toContain('messages.reply');
    expect(SYSTEM_ROLES.ADMIN.permissions).toContain('messages.reply');
    for (const role of [SYSTEM_ROLES.WAREHOUSE_MANAGER, SYSTEM_ROLES.SALES_REPRESENTATIVE, SYSTEM_ROLES.VIEWER]) {
      expect(role.permissions as readonly string[]).not.toContain('messages.view');
    }
  });

  it('exists in the database after the migration', async () => {
    const keys = (await prisma.permission.findMany({ where: { module: 'messages' }, select: { key: true } })).map((p) => p.key).sort();
    expect(keys).toEqual(['messages.reply', 'messages.view']);
  });
});
