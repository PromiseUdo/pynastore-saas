/*
 * Photos in Messages: either side can send one, only this shop's chat
 * photos are accepted, they're deleted after CHAT_PHOTO_DAYS, and a shopper
 * deleting their account takes theirs at once. Cloudinary is never called:
 * fetch is replaced and every delete it would have made is recorded.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost' }),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

import { prisma } from '@/lib/prisma';
import { getShopperChat, listStaffMessages, sendCustomerMessage, sendStaffMessage } from '@/lib/chat/service';
import { expireChatPhotos } from '@/lib/chat/photos';
import { deleteShopperAccount } from '@/lib/data-rights/shopper';
import { chatPhotoFolder } from '@/lib/cloudinary/sign';
import { CHAT_PHOTO_DAYS, PHOTO_PREVIEW } from '@/lib/chat/rules';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-chat-photo-${suffix}` };
const other = { id: '', slug: `__test-chat-photo-other-${suffix}` };
let customerId = '';
let staffId = '';
const DAY = 24 * 60 * 60 * 1000;

const photoIn = (organizationId: string, name = randomUUID().slice(0, 8)) => {
  const publicId = `${chatPhotoFolder(organizationId)}/${name}`;
  return { url: `https://res.cloudinary.com/ci-cloud/image/upload/v1/${publicId}.jpg`, publicId, width: 1200, height: 900 };
};

const destroyed: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Photo Store', slug: store.slug, storefrontChatEnabled: true, storefrontOpen: true } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug, storefrontChatEnabled: true, storefrontOpen: true } })).id;
  customerId = (await prisma.customer.create({ data: { organizationId: store.id, name: 'Ada', email: `ada-photo-${suffix}@example.com`, emailVerifiedAt: new Date() } })).id;
  staffId = (await prisma.user.create({ data: { email: `staff-photo-${suffix}@example.com`, name: 'Kemi' } })).id;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.cloudinary.com') && url.endsWith('/image/destroy')) {
      destroyed.push(new URLSearchParams(String(init?.body)).get('public_id') ?? '');
      return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

beforeEach(() => {
  destroyed.length = 0;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await prisma.chatConversation.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.customer.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [store.id, other.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [store.id, other.id] } } });
  await prisma.user.deleteMany({ where: { id: staffId } });
});

const shopper = () => ({ kind: 'customer' as const, customerId });

describe('sending a photo', () => {
  it('lets a shopper send a photo with no words, and shows it to both sides', async () => {
    const photo = photoIn(store.id);
    const sent = await sendCustomerMessage(store.id, shopper(), { clientId: randomUUID(), body: '', photo });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.message.photo).toEqual({ url: photo.url, width: 1200, height: 900 });
    expect(sent.message.photoExpired).toBe(false);

    const conversation = await prisma.chatConversation.findUniqueOrThrow({ where: { id: sent.conversationId } });
    expect(conversation.lastPreview).toBe(PHOTO_PREVIEW);

    const staffView = await listStaffMessages(store.id, sent.conversationId);
    expect(staffView?.messages.at(-1)?.photo?.url).toBe(photo.url);

    const row = await prisma.chatMessage.findFirstOrThrow({ where: { id: sent.message.id } });
    const days = (row.photoExpiresAt!.getTime() - row.createdAt.getTime()) / DAY;
    expect(Math.round(days)).toBe(CHAT_PHOTO_DAYS);
  });

  it('lets the store reply with a photo and a caption', async () => {
    const conversationId = (await getShopperChat(store.id, shopper())).conversation!.id;
    const photo = photoIn(store.id);
    const sent = await sendStaffMessage(store.id, { conversationId, staffUserId: staffId, clientId: randomUUID(), body: 'This one?', photo });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.message.body).toBe('This one?');
    expect(sent.message.photo?.url).toBe(photo.url);
    const conversation = await prisma.chatConversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.lastPreview).toBe(`${PHOTO_PREVIEW} · This one?`);

    const shopperView = await getShopperChat(store.id, shopper());
    expect(shopperView.messages.at(-1)?.photo?.url).toBe(photo.url);
  });

  it('refuses another shop’s photo, a photo outside the chat folder, and a photo from elsewhere', async () => {
    const otherShops = photoIn(other.id);
    const productImage = { url: `https://res.cloudinary.com/ci-cloud/image/upload/v1/mansaas/${store.id}/products/x.jpg`, publicId: `mansaas/${store.id}/products/x` };
    const elsewhere = { url: 'https://evil.example/x.jpg', publicId: `${chatPhotoFolder(store.id)}/x` };
    for (const photo of [otherShops, productImage, elsewhere]) {
      const sent = await sendCustomerMessage(store.id, shopper(), { clientId: randomUUID(), body: 'look', photo });
      expect(sent).toMatchObject({ ok: false, code: 'invalid' });
    }
  });

  it('still needs words when there is no photo', async () => {
    const sent = await sendCustomerMessage(store.id, shopper(), { clientId: randomUUID(), body: '   ' });
    expect(sent).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('after seven days', () => {
  it('deletes the file and leaves a note that a photo was there', async () => {
    const photo = photoIn(store.id);
    const sent = await sendCustomerMessage(store.id, shopper(), { clientId: randomUUID(), body: 'old one', photo });
    if (!sent.ok) throw new Error('not sent');

    expect(await expireChatPhotos(new Date(Date.now() + (CHAT_PHOTO_DAYS - 1) * DAY))).toBe(0);
    expect(destroyed).not.toContain(photo.publicId);

    await expireChatPhotos(new Date(Date.now() + (CHAT_PHOTO_DAYS + 1) * DAY));
    expect(destroyed).toContain(photo.publicId);

    const view = await getShopperChat(store.id, shopper());
    const message = view.messages.find((m) => m.id === sent.message.id)!;
    expect(message.photo).toBeNull();
    expect(message.photoExpired).toBe(true);
    expect(message.body).toBe('old one');
  });

  it('tries again tomorrow when Cloudinary won’t delete it', async () => {
    const photo = photoIn(store.id);
    const sent = await sendCustomerMessage(store.id, shopper(), { clientId: randomUUID(), body: '', photo });
    if (!sent.ok) throw new Error('not sent');
    const working = globalThis.fetch;
    globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch;
    try {
      await expireChatPhotos(new Date(Date.now() + (CHAT_PHOTO_DAYS + 1) * DAY));
    } finally {
      globalThis.fetch = working;
    }
    const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id: sent.message.id } });
    expect(row.photoPublicId).toBe(photo.publicId);
  });
});

describe('a shopper deleting their account', () => {
  it('removes the photos from their chat straight away', async () => {
    const photo = photoIn(store.id);
    await sendCustomerMessage(store.id, shopper(), { clientId: randomUUID(), body: '', photo });
    await deleteShopperAccount(store.id, customerId);
    expect(destroyed).toContain(photo.publicId);
    expect(await prisma.chatMessage.count({ where: { photoPublicId: photo.publicId } })).toBe(0);
  });
});
