/*
 * lib/chat/photos.ts — photos in Messages, server side.
 *
 * Either side may send one photo with a message (with or without words).
 * The browser uploads it straight to Cloudinary with parameters signed here
 * (lib/cloudinary/sign.ts), then names it when sending; the service checks
 * it really is this shop's chat photo before saving it. A photo is kept
 * CHAT_PHOTO_DAYS: the daily data-retention job deletes the file and clears
 * the link, keeping photoExpiresAt so the conversation can say it expired.
 * A shopper deleting their account, or a shop being purged, takes them
 * sooner. Server only.
 */
import { prisma } from '@/lib/prisma';
import { destroyAsset, isChatPhoto } from '@/lib/cloudinary/sign';
import { CHAT_PHOTO_DAYS, type ChatPhoto } from './rules';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PhotoFields {
  photoUrl: string;
  photoPublicId: string;
  photoWidth: number | null;
  photoHeight: number | null;
  photoExpiresAt: Date;
}

export type PhotoCheck = { ok: true; fields: PhotoFields | null } | { ok: false; message: string };

const dimension = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : null;

/**
 * The photo a send names, checked: absent is fine (a words-only message);
 * anything else must be a chat photo in this shop's folder on our account.
 */
export function checkChatPhoto(input: unknown, organizationId: string, now: Date): PhotoCheck {
  if (input === undefined || input === null) return { ok: true, fields: null };
  const photo = input as { url?: unknown; publicId?: unknown; width?: unknown; height?: unknown };
  if (typeof photo.url !== 'string' || typeof photo.publicId !== 'string' || !isChatPhoto({ url: photo.url, publicId: photo.publicId }, organizationId)) {
    return { ok: false, message: 'That photo couldn’t be attached. Please choose it again.' };
  }
  return {
    ok: true,
    fields: {
      photoUrl: photo.url,
      photoPublicId: photo.publicId,
      photoWidth: dimension(photo.width),
      photoHeight: dimension(photo.height),
      photoExpiresAt: new Date(now.getTime() + CHAT_PHOTO_DAYS * DAY_MS),
    },
  };
}

/** A saved message's photo as either side sees it. */
export function photoOf(row: { photoUrl: string | null; photoWidth: number | null; photoHeight: number | null; photoExpiresAt: Date | null }): {
  photo: ChatPhoto | null;
  photoExpired: boolean;
} {
  if (row.photoUrl) return { photo: { url: row.photoUrl, width: row.photoWidth, height: row.photoHeight }, photoExpired: false };
  return { photo: null, photoExpired: row.photoExpiresAt !== null };
}

export const PHOTO_SELECT = { photoUrl: true, photoWidth: true, photoHeight: true, photoExpiresAt: true } as const;

/**
 * Delete every chat photo past its time (the daily data-retention job).
 * The file goes first; the message then keeps only photoExpiresAt. A file
 * Cloudinary wouldn't delete is tried again tomorrow.
 */
export async function expireChatPhotos(now = new Date(), { batch = 500 }: { batch?: number } = {}): Promise<number> {
  const due = await prisma.chatMessage.findMany({
    where: { photoPublicId: { not: null }, photoExpiresAt: { lte: now } },
    select: { id: true, photoPublicId: true },
    orderBy: { photoExpiresAt: 'asc' },
    take: batch,
  });
  let expired = 0;
  for (const message of due) {
    if (!(await destroyAsset(message.photoPublicId!))) continue;
    await prisma.chatMessage.update({ where: { id: message.id }, data: { photoUrl: null, photoPublicId: null } });
    expired += 1;
  }
  return expired;
}

/** The chat photos still held for these conversations — read before they're deleted, to remove the files after. */
export async function chatPhotoIds(where: { organizationId: string; customerId?: string; conversationIds?: string[] }): Promise<string[]> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      organizationId: where.organizationId,
      photoPublicId: { not: null },
      ...(where.conversationIds ? { conversationId: { in: where.conversationIds } } : {}),
      ...(where.customerId ? { conversation: { customerId: where.customerId } } : {}),
    },
    select: { photoPublicId: true },
  });
  return rows.map((r) => r.photoPublicId!);
}

/** Remove photo files whose messages are already gone. Best effort. */
export async function destroyChatPhotos(publicIds: readonly string[]): Promise<void> {
  for (const id of publicIds) await destroyAsset(id);
}
