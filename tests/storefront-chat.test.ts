/*
 * The storefront chat's API (ROADMAP 17.3), against the real database, with
 * requests built the way a browser sends them — the store comes from the
 * Host (or the mobile mall's Referer), never from the body.
 *
 * What it rests on: a shopper only ever reaches their own conversation; a
 * guest cookie appears only when a message is really saved; and a guest who
 * signs in keeps what they wrote.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* The browser's cookies for this test, and whatever the route sets. */
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost' }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

import { prisma } from '@/lib/prisma';
import { createTestStores, mobileRequest, pinDomains, storefrontHost, storefrontRequest } from './helpers/storefront-requests';
import { GET as getChat } from '@/app/api/storefront/chat/route';
import { POST as postMessage } from '@/app/api/storefront/chat/messages/route';
import { POST as postRead } from '@/app/api/storefront/chat/read/route';
import { chatGuestCookieName } from '@/lib/chat/identity';
import { adoptGuestChatOnSignIn, shopperChatStatus } from '@/lib/chat/storefront';
import { sendStaffMessage, setConversationBlocked } from '@/lib/chat/service';
import { sessionCookieName, signSessionToken } from '@/lib/storefront/account/session';

pinDomains();

let stores: { id: string; slug: string }[] = [];
let cleanup: () => Promise<void> = async () => {};
let store = { id: '', slug: '' };
let other = { id: '', slug: '' };
let staffId = '';
let ada = '';

const get = (query = '', slug = store.slug) => {
  const host = storefrontHost(slug);
  return getChat(new Request(`http://${host}/api/storefront/chat${query ? `?${query}` : ''}`, { headers: { host, referer: `http://${host}/` } }));
};
/* Each send comes from its own address unless a test says otherwise, so the
 * per-IP limits (17.5) only bite in the tests about them. */
let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const send = (body: Record<string, unknown>, slug = store.slug, ip = freshIp()) =>
  postMessage(storefrontRequest(slug, '/api/storefront/chat/messages', { clientId: randomUUID(), ...body }, { 'x-forwarded-for': ip }));

beforeAll(async () => {
  ({ stores, cleanup } = await createTestStores('__test-sfchat', 2));
  [store, other] = stores;
  await prisma.organization.updateMany({ where: { id: { in: [store.id, other.id] } }, data: { storefrontChatEnabled: true } });
  staffId = (await prisma.user.create({ data: { email: `sfchat-${Date.now()}@example.com`, name: 'Kemi' } })).id;
  ada = (await prisma.customer.create({ data: { organizationId: store.id, name: 'Ada Okafor', email: `ada-sfchat-${Date.now()}@example.com` } })).id;
});

beforeEach(async () => {
  jar.clear();
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.organization.updateMany({ where: { id: { in: [store.id, other.id] } }, data: { storefrontChatEnabled: true, storefrontOpen: true } });
});

afterAll(async () => {
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: stores.map((s) => s.id) } } });
  await prisma.customer.deleteMany({ where: { organizationId: { in: stores.map((s) => s.id) } } });
  await prisma.user.delete({ where: { id: staffId } });
  await cleanup();
});

describe('reading', () => {
  it('gives a newcomer an empty conversation and leaves no cookie', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ conversation: null, messages: [], hasEarlier: false, open: true });
    expect(jar.size).toBe(0);
  });

  it('says when the store isn’t taking messages', async () => {
    await prisma.organization.update({ where: { id: store.id }, data: { storefrontChatEnabled: false } });
    expect((await (await get()).json()).open).toBe(false);
  });

  it('survives a nonsense position instead of failing', async () => {
    expect((await get(`after=${2 ** 40}`)).status).toBe(200);
    expect((await get('before=-3')).status).toBe(200);
  });
});

describe('sending as a guest', () => {
  it('saves the message, sets the guest cookie, and shows it back', async () => {
    const response = await send({ body: 'Is this shoe available in size 43?', guestName: 'Sarah' });
    expect(response.status).toBe(200);
    expect((await response.json()).message).toMatchObject({ seq: 1, sender: 'CUSTOMER', author: null });
    expect(jar.has(chatGuestCookieName(store.slug))).toBe(true);

    const body = await (await get()).json();
    expect(body.messages.map((m: { body: string }) => m.body)).toEqual(['Is this shoe available in size 43?']);
    expect(await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } })).toMatchObject({
      guestName: 'Sarah',
      customerId: null,
    });
    // Nobody was made a customer for it.
    expect(await prisma.customer.count({ where: { organizationId: store.id } })).toBe(1);
  });

  it('shows another browser nothing', async () => {
    await send({ body: 'My private question' });
    jar.clear();
    expect((await (await get()).json()).conversation).toBeNull();
  });

  it('refuses a bad message without setting a cookie', async () => {
    expect((await send({ body: '   ' })).status).toBe(400);
    expect((await send({ body: 'hello', clientId: 'no' })).status).toBe(400);
    const notJson = await postMessage(
      storefrontRequest(store.slug, '/api/storefront/chat/messages', 'body=hi', { 'content-type': 'application/x-www-form-urlencoded' }),
    );
    expect(notJson.status).toBe(415);
    expect(jar.size).toBe(0);
  });

  it('refuses while chat is off, without setting a cookie', async () => {
    await prisma.organization.update({ where: { id: store.id }, data: { storefrontChatEnabled: false } });
    const response = await send({ body: 'Hello?' });
    expect(response.status).toBe(409);
    expect(jar.size).toBe(0);
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id } })).toBe(0);
  });

  it('won’t take a store from the body that isn’t the one on the address', async () => {
    const response = await send({ body: 'Hello', org: other.slug });
    expect(response.status).toBe(403);
    expect(await prisma.chatConversation.count({ where: { organizationId: { in: [store.id, other.id] } } })).toBe(0);
  });

  it('works from the mobile mall, by the page the shopper is on', async () => {
    const response = await postMessage(mobileRequest(store.slug, '/api/storefront/chat/messages', { clientId: randomUUID(), body: 'From the app' }));
    expect(response.status).toBe(200);
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id } })).toBe(1);
  });

  it('tells a blocked shopper plainly', async () => {
    await send({ body: 'First' });
    const conversation = await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } });
    await setConversationBlocked(store.id, conversation.id, staffId, true);
    const response = await send({ body: 'Again' });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('blocked');
  });
});

describe('replies and read marks', () => {
  it('shows the store’s reply as “Store team”, counts it unread, and clears it when read', async () => {
    await send({ body: 'Hello' });
    const conversation = await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } });
    await sendStaffMessage(store.id, { conversationId: conversation.id, staffUserId: staffId, clientId: randomUUID(), body: 'Hi! Yes, we have it.' });

    const summary = await (await get('summary=1')).json();
    expect(summary.messages).toEqual([]);
    expect(summary.conversation.unread).toBe(1);

    const poll = await (await get('after=1&open=1')).json();
    expect(poll.messages).toEqual([expect.objectContaining({ seq: 2, author: 'Store team', body: 'Hi! Yes, we have it.' })]);
    expect(JSON.stringify(poll)).not.toContain('Kemi');

    const read = await postRead(storefrontRequest(store.slug, '/api/storefront/chat/read', { upTo: 2 }));
    expect(read.status).toBe(200);
    expect((await (await get('summary=1')).json()).conversation.unread).toBe(0);
  });

  it('only ever moves the reader’s own mark', async () => {
    await send({ body: 'Mine' });
    jar.clear();
    const read = await postRead(storefrontRequest(store.slug, '/api/storefront/chat/read', { upTo: 1 }));
    expect(read.status).toBe(200);
    expect((await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } })).customerReadSeq).toBe(1);
    expect((await postRead(storefrontRequest(store.slug, '/api/storefront/chat/read', { upTo: 'all' }))).status).toBe(400);
  });
});

describe('signed-in shoppers', () => {
  async function signInAda() {
    jar.set(sessionCookieName(store.slug), await signSessionToken({ customerId: ada, organizationId: store.id, slug: store.slug, sessionVersion: 0 }));
  }

  it('writes as their account, with no guest cookie', async () => {
    await signInAda();
    expect((await send({ body: 'From my account', guestName: 'ignored' })).status).toBe(200);
    expect(await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } })).toMatchObject({
      customerId: ada,
      guestKeyHash: null,
      guestName: null,
    });
    expect(jar.has(chatGuestCookieName(store.slug))).toBe(false);
  });

  it('keeps what they wrote as a guest when they sign in', async () => {
    await send({ body: 'Asked before signing in' });
    await signInAda();
    await adoptGuestChatOnSignIn(store, ada);

    const body = await (await get()).json();
    expect(body.messages.map((m: { body: string }) => m.body)).toEqual(['Asked before signing in']);
    expect(await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } })).toMatchObject({ customerId: ada });
  });

  it('does nothing on sign-in for a browser that never wrote', async () => {
    await adoptGuestChatOnSignIn(store, ada);
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id } })).toBe(0);
  });
});

describe('what the layout knows on first paint', () => {
  it('finds nothing for a newcomer, and the conversation and unread count for someone who wrote', async () => {
    const at = { slug: store.slug, organizationId: store.id };
    expect(await shopperChatStatus(at)).toEqual({ exists: false, unread: 0 });

    await send({ body: 'Hello' });
    expect(await shopperChatStatus(at)).toEqual({ exists: true, unread: 0 });

    const conversation = await prisma.chatConversation.findFirstOrThrow({ where: { organizationId: store.id } });
    await sendStaffMessage(store.id, { conversationId: conversation.id, staffUserId: staffId, clientId: randomUUID(), body: 'Reply' });
    expect(await shopperChatStatus(at)).toEqual({ exists: true, unread: 1 });
  });
});

describe('how fast a shopper may send (17.5)', () => {
  afterEach(() => {
    delete process.env.CHAT_STORE_GUEST_MAX_PER_HOUR;
  });

  it('stops a shopper sending faster than a person types, and says so plainly', async () => {
    const ip = '192.0.2.10';
    for (let i = 0; i < 10; i++) expect((await send({ body: `Message ${i}` }, store.slug, ip)).status).toBe(200);
    const refused = await send({ body: 'One too many' }, store.slug, ip);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBeTruthy();
    expect(await refused.json()).toEqual({ error: 'You’re sending messages a little fast. Give it a moment and try again.', code: 'too-fast' });
    expect(await prisma.chatMessage.count({ where: { organizationId: store.id } })).toBe(10);
  });

  it('limits fresh guest conversations from one address, without setting a cookie when it refuses', async () => {
    const ip = '192.0.2.20';
    for (let i = 0; i < 5; i++) {
      jar.clear();
      expect((await send({ body: `New guest ${i}` }, store.slug, ip)).status).toBe(200);
    }
    jar.clear();
    expect((await send({ body: 'Sixth fresh guest' }, store.slug, ip)).status).toBe(429);
    expect(jar.size).toBe(0);
    expect(await prisma.chatConversation.count({ where: { organizationId: store.id } })).toBe(5);
  });

  it('lets an existing conversation carry on from that same address', async () => {
    const ip = '192.0.2.30';
    for (let i = 0; i < 5; i++) {
      jar.clear();
      await send({ body: `Guest ${i}` }, store.slug, ip);
    }
    // The last guest's cookie is still in the jar: they already have a conversation.
    expect((await send({ body: 'Following up' }, store.slug, ip)).status).toBe(200);
  });

  it('caps guest messages per store, but not signed-in shoppers', async () => {
    process.env.CHAT_STORE_GUEST_MAX_PER_HOUR = '2';
    // The bucket is per store; use the second store so the cap starts empty.
    await prisma.chatConversation.deleteMany({ where: { organizationId: other.id } });
    for (let i = 0; i < 2; i++) {
      jar.clear();
      expect((await send({ body: `Guest ${i}` }, other.slug)).status).toBe(200);
    }
    jar.clear();
    expect((await send({ body: 'Third guest this hour' }, other.slug)).status).toBe(429);

    const tunde = (await prisma.customer.create({ data: { organizationId: other.id, name: 'Tunde', email: `tunde-cap-${Date.now()}@example.com` } })).id;
    jar.set(sessionCookieName(other.slug), await signSessionToken({ customerId: tunde, organizationId: other.id, slug: other.slug, sessionVersion: 0 }));
    expect((await send({ body: 'Signed in, not capped' }, other.slug)).status).toBe(200);
  });
});

