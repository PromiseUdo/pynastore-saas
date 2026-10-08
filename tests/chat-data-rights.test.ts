/*
 * Messages and data rights (ROADMAP 17.5), against the real database.
 *
 * A shopper's chat is theirs like their reviews and questions: it is in the
 * copy they download, and it goes when they delete their account. A guest
 * has no account, so their chat ends a year after anyone last wrote in it.
 * A closed store's chats go with the rest of its shoppers' data at day 30.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cloudinary/sign', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cloudinary/sign')>()),
  destroyOrganizationAssets: vi.fn(async () => 0),
}));

import { prisma } from '@/lib/prisma';
import { sendCustomerMessage, sendStaffMessage } from '@/lib/chat/service';
import { deleteShopperAccount, exportShopperData } from '@/lib/data-rights/shopper';
import { runDataRetention } from '@/lib/data-rights/retention';
import { purgeClosedWorkspace } from '@/lib/data-rights/workspace';
import { GUEST_CHAT_RETENTION_MONTHS, guestChatCutoff } from '@/lib/data-rights/policy';
import { hashGuestKey, type ChatIdentity } from '@/lib/chat/identity';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let storeId = '';
let otherId = '';
let staffId = '';

async function customer(organizationId: string, name: string) {
  return (await prisma.customer.create({ data: { organizationId, name, email: `${name.toLowerCase()}-${suffix}@example.com` } })).id;
}

async function write(organizationId: string, identity: ChatIdentity, body: string, at?: Date) {
  const sent = await sendCustomerMessage(organizationId, identity, { clientId: randomUUID(), body }, at);
  if (!sent.ok) throw new Error(sent.message);
  return sent.conversationId;
}

const guest = (seed: string): ChatIdentity => ({ kind: 'guest', guestKeyHash: hashGuestKey(seed.repeat(43).slice(0, 43)) });

beforeAll(async () => {
  storeId = (await prisma.organization.create({ data: { name: 'Rights Store', slug: `__test-chatrights-${suffix}`, storefrontChatEnabled: true } })).id;
  otherId = (await prisma.organization.create({ data: { name: 'Other Rights', slug: `__test-chatrights-o-${suffix}`, storefrontChatEnabled: true } })).id;
  staffId = (await prisma.user.create({ data: { email: `chatrights-${suffix}@example.com`, name: 'Kemi' } })).id;
});

beforeEach(async () => {
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [storeId, otherId] } } });
});

afterAll(async () => {
  for (const id of [storeId, otherId]) {
    await prisma.chatConversation.deleteMany({ where: { organizationId: id } });
    await prisma.order.deleteMany({ where: { organizationId: id } });
    await prisma.customer.deleteMany({ where: { organizationId: id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: id } });
  }
  await prisma.organization.deleteMany({ where: { id: { in: [storeId, otherId] } } });
  await prisma.user.delete({ where: { id: staffId } });
});

describe('a shopper’s copy of their data', () => {
  it('includes both sides of their chat, the store’s signed “Store team”', async () => {
    const ada = await customer(storeId, 'Ada');
    const conversationId = await write(storeId, { kind: 'customer', customerId: ada }, 'Is this in size 43?');
    await sendStaffMessage(storeId, { conversationId, staffUserId: staffId, clientId: randomUUID(), body: 'Yes, it is.' });

    const data = await exportShopperData(storeId, ada);
    expect(data?.messages).toEqual([
      expect.objectContaining({ from: 'you', message: 'Is this in size 43?' }),
      expect.objectContaining({ from: 'Store team', message: 'Yes, it is.' }),
    ]);
    expect(JSON.stringify(data)).not.toContain('Kemi');
  });

  it('is empty for someone who never wrote', async () => {
    const bola = await customer(storeId, 'Bola');
    expect((await exportShopperData(storeId, bola))?.messages).toEqual([]);
  });
});

describe('deleting a shopper’s account', () => {
  it('removes their chat when nothing else ties them to the store', async () => {
    const chidi = await customer(storeId, 'Chidi');
    const id = await write(storeId, { kind: 'customer', customerId: chidi }, 'Hello');
    expect(await deleteShopperAccount(storeId, chidi)).toBe('deleted');
    expect(await prisma.chatConversation.count({ where: { id } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { conversationId: id } })).toBe(0);
  });

  it('removes their chat even when their orders have to be kept', async () => {
    const dayo = await customer(storeId, 'Dayo');
    await prisma.order.create({
      data: { organizationId: storeId, customerId: dayo, reference: `R-${suffix}`, paymentMethod: 'pay_on_delivery', totalAmount: 1000, subtotal: 1000 },
    });
    const id = await write(storeId, { kind: 'customer', customerId: dayo }, 'Where is my parcel?');
    expect(await deleteShopperAccount(storeId, dayo)).toBe('records-kept');
    expect(await prisma.chatConversation.count({ where: { id } })).toBe(0);
  });

  it('leaves everyone else’s chats alone', async () => {
    const emeka = await customer(storeId, 'Emeka');
    const funmi = await customer(storeId, 'Funmi');
    await write(storeId, { kind: 'customer', customerId: emeka }, 'Mine');
    const kept = await write(storeId, { kind: 'customer', customerId: funmi }, 'Also mine');
    const guestChat = await write(storeId, guest('a'), 'A guest');
    await deleteShopperAccount(storeId, emeka);
    expect(await prisma.chatConversation.count({ where: { id: { in: [kept, guestChat] } } })).toBe(2);
  });
});

describe('the daily retention job', () => {
  const now = new Date('2027-10-08T03:00:00Z');
  const longAgo = new Date(guestChatCutoff(now).getTime() - 86_400_000);
  const recently = new Date(now.getTime() - 30 * 86_400_000);

  it('removes a guest chat nobody has written in for a year, and keeps a recent one', async () => {
    const old = await write(storeId, guest('o'), 'Anyone there?', longAgo);
    const recent = await write(storeId, guest('r'), 'Still interested', recently);

    const result = await runDataRetention({ now, only: [storeId] });
    expect(result.guestChatsRemoved).toBe(1);
    expect(await prisma.chatConversation.count({ where: { id: old } })).toBe(0);
    expect(await prisma.chatConversation.count({ where: { id: recent } })).toBe(1);
  });

  it('never removes a signed-in shopper’s chat, however old', async () => {
    const gbenga = await customer(storeId, 'Gbenga');
    const id = await write(storeId, { kind: 'customer', customerId: gbenga }, 'Old question', longAgo);
    await runDataRetention({ now, only: [storeId] });
    expect(await prisma.chatConversation.count({ where: { id } })).toBe(1);
  });

  it('counts from the last message, not the first', async () => {
    const id = await write(storeId, guest('l'), 'Started long ago', longAgo);
    await write(storeId, guest('l'), 'Came back recently', recently);
    await runDataRetention({ now, only: [storeId] });
    expect(await prisma.chatConversation.count({ where: { id } })).toBe(1);
  });

  it('keeps the policy at a year', () => {
    expect(GUEST_CHAT_RETENTION_MONTHS).toBe(12);
    expect(guestChatCutoff(new Date('2027-10-08T00:00:00Z')).toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
});

describe('a closed store', () => {
  it('loses every chat at the day-30 purge, and another store keeps theirs', async () => {
    const hauwa = await customer(otherId, 'Hauwa');
    await write(otherId, { kind: 'customer', customerId: hauwa }, 'From a closing store');
    await write(otherId, guest('c'), 'A guest there');
    const elsewhere = await write(storeId, guest('e'), 'Elsewhere');

    const closedAt = new Date('2026-09-01T00:00:00Z');
    await prisma.organization.update({ where: { id: otherId }, data: { status: 'DELETED', closedAt } });
    const { purged } = await purgeClosedWorkspace(otherId, new Date('2026-10-05T00:00:00Z'));
    expect(purged).toBe(true);

    expect(await prisma.chatConversation.count({ where: { organizationId: otherId } })).toBe(0);
    expect(await prisma.chatMessage.count({ where: { organizationId: otherId } })).toBe(0);
    expect(await prisma.chatConversation.count({ where: { id: elsewhere } })).toBe(1);
  });
});
