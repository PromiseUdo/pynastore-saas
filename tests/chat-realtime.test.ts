/*
 * Messages in real time (Ably), against the real database, with Ably's
 * network calls captured. Token requests are signed for real — that happens
 * locally with the key — so the tests read exactly what a browser would be
 * allowed to do.
 *
 *   - a saved message or status change publishes a small hint after the
 *     response, to the right channels, without the message text; read marks
 *     and retried sends publish nothing;
 *   - a shopper's token covers only their own conversation, a member's only
 *     their own store's inbox, and neither can publish;
 *   - without ABLY_API_KEY nothing is published and no token is issued.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost' }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const published = vi.hoisted(() => [] as { channel: string; event: string; data: unknown }[]);
vi.mock('ably', async (importOriginal) => {
  const real = await importOriginal<typeof import('ably')>();
  class Rest {
    auth: InstanceType<typeof real.Rest>['auth'];
    channels: { get: (name: string) => { publish: (event: string, data: unknown) => Promise<void> } };
    constructor(options: ConstructorParameters<typeof real.Rest>[0]) {
      this.auth = new real.Rest(options).auth; // signs token requests locally — no network
      this.channels = {
        get: (channel) => ({
          publish: async (event, data) => {
            published.push({ channel, event, data });
          },
        }),
      };
    }
  }
  return { ...real, Rest };
});

let memberPermissions: string[] = [];
let accessState: 'active' | 'lapsed' = 'active';
const ctx = { organization: { id: '', slug: '' }, membership: { role: { permissions: [] as string[] } }, userId: '' };
vi.mock('@/lib/organization', () => ({
  getOrganizationContext: async () => ({ ...ctx, membership: { ...ctx.membership, role: { permissions: memberPermissions } } }),
}));
vi.mock('@/lib/billing/entitlements', () => ({ getOrganizationEntitlements: async () => ({ access: { state: accessState } }) }));

import { prisma } from '@/lib/prisma';
import { createTestStores, pinDomains, storefrontRequest } from './helpers/storefront-requests';
import { chatChannelName, inboxChannelName } from '@/lib/chat/ably';
import { resetAblyClient } from '@/lib/realtime/ably';
import { discardAfterTasks, flushAfterTasks } from '@/lib/run-after';
import {
  markReadByCustomer,
  markReadByStaff,
  sendCustomerMessage,
  sendStaffMessage,
  setConversationBlocked,
  setConversationResolved,
} from '@/lib/chat/service';
import { hashGuestKey, chatGuestCookieName, type ChatIdentity } from '@/lib/chat/identity';
import { PERMISSIONS } from '@/lib/permissions';
import { POST as postMessage } from '@/app/api/storefront/chat/messages/route';
import { POST as shopperToken } from '@/app/api/storefront/chat/realtime-token/route';
import { POST as staffToken } from '@/app/(dashboard)/[organizationSlug]/messages/realtime-token/route';

pinDomains();

const KEY = 'appId123.keyId456:not-a-real-secret-but-long-enough';
let store = { id: '', slug: '' };
let other = { id: '', slug: '' };
let cleanup = async () => {};
let staffId = '';

const guestKey = (seed: string) => seed.repeat(43).slice(0, 43);
const guest = (seed: string): ChatIdentity => ({ kind: 'guest', guestKeyHash: hashGuestKey(guestKey(seed)) });

async function shopperWrites(identity: ChatIdentity, organizationId = store.id, clientId = randomUUID()) {
  const sent = await sendCustomerMessage(organizationId, identity, { clientId, body: 'Is this in size 43?' });
  if (!sent.ok) throw new Error(sent.message);
  return sent;
}

const tokenRequest = (slug = store.slug, body: Record<string, unknown> = {}) =>
  shopperToken(storefrontRequest(slug, '/api/storefront/chat/realtime-token', body, { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }));
const adminTokenRequest = (contentType = 'application/json') =>
  staffToken(new Request('http://acme.localhost/messages/realtime-token', { method: 'POST', headers: { 'content-type': contentType }, body: '{}' }));

/** What a token request allows, as Ably will read it. */
async function capabilityOf(response: Response): Promise<Record<string, string[]>> {
  const body = (await response.json()) as { tokenRequest: { capability: string; keyName: string; mac: string } };
  expect(body.tokenRequest.keyName).toBe('appId123.keyId456');
  expect(body.tokenRequest.mac).toBeTruthy();
  expect(JSON.stringify(body)).not.toContain('not-a-real-secret');
  return JSON.parse(body.tokenRequest.capability) as Record<string, string[]>;
}

beforeAll(async () => {
  const made = await createTestStores('__test-chatrt', 2);
  cleanup = made.cleanup;
  [store, other] = made.stores;
  await prisma.organization.updateMany({ where: { id: { in: [store.id, other.id] } }, data: { storefrontChatEnabled: true } });
  staffId = (await prisma.user.create({ data: { email: `chatrt-${Date.now()}@example.com`, name: 'Kemi' } })).id;
  ctx.organization = { id: store.id, slug: store.slug };
  ctx.userId = staffId;
}, 60_000);

beforeEach(async () => {
  process.env.ABLY_API_KEY = KEY;
  resetAblyClient();
  jar.clear();
  published.length = 0;
  discardAfterTasks();
  memberPermissions = [PERMISSIONS.MESSAGES_VIEW, PERMISSIONS.MESSAGES_REPLY];
  accessState = 'active';
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
});

afterEach(() => {
  delete process.env.ABLY_API_KEY;
  resetAblyClient();
});

afterAll(async () => {
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.user.delete({ where: { id: staffId } });
  await cleanup();
}, 60_000);

describe('publishing', () => {
  it('tells the store’s inbox about a shopper’s message — after the response, without its text', async () => {
    const sent = await shopperWrites(guest('a'));
    expect(published).toHaveLength(0); // nothing until the response has gone
    await flushAfterTasks();
    expect(published).toEqual([
      {
        channel: inboxChannelName(store.id),
        event: 'change',
        data: { type: 'message', conversationId: sent.conversationId, seq: 1, sender: 'CUSTOMER' },
      },
    ]);
    expect(JSON.stringify(published)).not.toContain('size 43');
  });

  it('tells the shopper and the inbox about the store’s reply', async () => {
    const { conversationId } = await shopperWrites(guest('b'));
    await flushAfterTasks();
    published.length = 0;
    await sendStaffMessage(store.id, { conversationId, staffUserId: staffId, clientId: randomUUID(), body: 'Yes, it is.' });
    await flushAfterTasks();
    expect(published.map((p) => p.channel).sort()).toEqual([chatChannelName(store.id, conversationId), inboxChannelName(store.id)].sort());
    expect(published.every((p) => JSON.stringify(p.data) === JSON.stringify({ type: 'message', conversationId, seq: 2, sender: 'STAFF' }))).toBe(true);
  });

  it('tells both about resolve, reopen, block and unblock, and nobody about read marks', async () => {
    const shopper = guest('c');
    const { conversationId } = await shopperWrites(shopper);
    await flushAfterTasks();
    published.length = 0;

    await markReadByStaff(store.id, conversationId, 1);
    await markReadByCustomer(store.id, shopper, 1);
    await flushAfterTasks();
    expect(published).toHaveLength(0);

    for (const step of [
      () => setConversationResolved(store.id, conversationId, staffId, true),
      () => setConversationResolved(store.id, conversationId, staffId, false),
      () => setConversationBlocked(store.id, conversationId, staffId, true),
      () => setConversationBlocked(store.id, conversationId, staffId, false),
    ]) {
      await step();
    }
    await flushAfterTasks();
    expect(published).toHaveLength(8);
    expect(published.every((p) => (p.data as { type: string }).type === 'status')).toBe(true);
  });

  it('publishes once for a send retried with the same clientId', async () => {
    const clientId = randomUUID();
    await shopperWrites(guest('d'), store.id, clientId);
    await shopperWrites(guest('d'), store.id, clientId);
    await flushAfterTasks();
    expect(published).toHaveLength(1);
  });

  it('publishes nothing when Ably isn’t configured', async () => {
    delete process.env.ABLY_API_KEY;
    resetAblyClient();
    await shopperWrites(guest('e'));
    await flushAfterTasks();
    expect(published).toHaveLength(0);
  });

  it('publishes after a send through the storefront route', async () => {
    const response = await postMessage(
      storefrontRequest(store.slug, '/api/storefront/chat/messages', { clientId: randomUUID(), body: 'Hi' }, { 'x-forwarded-for': '203.0.113.9' }),
    );
    expect(response.status).toBe(200);
    await flushAfterTasks();
    expect(published.some((p) => p.channel === inboxChannelName(store.id))).toBe(true);
  });
});

describe('a shopper’s token', () => {
  it('lets them listen to exactly their own conversation, and nothing else', async () => {
    jar.set(chatGuestCookieName(store.slug), guestKey('f'));
    const { conversationId } = await shopperWrites(guest('f'));

    const response = await tokenRequest();
    expect(response.status).toBe(200);
    expect(await capabilityOf(response)).toEqual({ [chatChannelName(store.id, conversationId)]: ['subscribe'] });
  });

  it('can’t be pointed at someone else’s conversation, whatever the body says', async () => {
    const theirs = await shopperWrites(guest('g'));
    jar.set(chatGuestCookieName(store.slug), guestKey('h'));
    const mine = await shopperWrites(guest('h'));

    const response = await tokenRequest(store.slug, { conversationId: theirs.conversationId, channel: chatChannelName(store.id, theirs.conversationId) });
    expect(await capabilityOf(response)).toEqual({ [chatChannelName(store.id, mine.conversationId)]: ['subscribe'] });
  });

  it('is refused before there’s a conversation, on another store’s address, and without Ably', async () => {
    jar.set(chatGuestCookieName(store.slug), guestKey('i'));
    expect((await tokenRequest()).status).toBe(404);

    await shopperWrites(guest('i'));
    expect((await tokenRequest(store.slug, { org: other.slug })).status).toBe(403);

    delete process.env.ABLY_API_KEY;
    resetAblyClient();
    expect((await tokenRequest()).status).toBe(503);
  });

  it('takes JSON only', async () => {
    const response = await shopperToken(
      storefrontRequest(store.slug, '/api/storefront/chat/realtime-token', 'org=x', { 'content-type': 'application/x-www-form-urlencoded' }),
    );
    expect(response.status).toBe(415);
  });
});

describe('a member’s token', () => {
  it('lets them listen to exactly their own store’s inbox', async () => {
    const response = await adminTokenRequest();
    expect(response.status).toBe(200);
    const capability = await capabilityOf(response);
    expect(capability).toEqual({ [inboxChannelName(store.id)]: ['subscribe'] });
    expect(Object.keys(capability)).not.toContain(inboxChannelName(other.id));
  });

  it('is refused without messages.view, once the plan has ended, without Ably, and for anything but JSON', async () => {
    memberPermissions = [PERMISSIONS.SALES_VIEW];
    expect((await adminTokenRequest()).status).toBe(403);
    memberPermissions = [PERMISSIONS.MESSAGES_VIEW];
    accessState = 'lapsed';
    expect((await adminTokenRequest()).status).toBe(403);
    accessState = 'active';
    expect((await adminTokenRequest('text/plain')).status).toBe(415);
    delete process.env.ABLY_API_KEY;
    resetAblyClient();
    expect((await adminTokenRequest()).status).toBe(503);
  });
});
