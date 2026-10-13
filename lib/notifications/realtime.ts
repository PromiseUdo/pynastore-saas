/*
 * lib/notifications/realtime.ts
 *
 * Telling an open bell that its list changed (ROADMAP 18.2), through the
 * shared Ably hints (lib/realtime/ably.ts). Server only.
 *
 * One channel per person and list, named here from server data only:
 *
 *   notifications:{organizationId}:user:{userId}           a member's list in one shop
 *   notifications:platform:user:{userId}                   a platform staff member's
 *   notifications:{organizationId}:customer:{customerId}   a shopper's in one shop
 *
 * An event carries the new unread count and nothing else — never a title or
 * a body. The bell asks the feed for the list itself. Browsers listen with
 * tokens for their one channel (the realtime-token routes). Without Ably
 * this does nothing and the bell polls.
 */
import { ablyConfigured, publishHint } from '@/lib/realtime/ably';
import { unreadCount, type Reader } from './readers';
import type { ListEvent } from './view';

export function listChannelName(reader: Reader): string {
  switch (reader.kind) {
    case 'staff':
      return `notifications:${reader.organizationId}:user:${reader.userId}`;
    case 'platform':
      return `notifications:platform:user:${reader.userId}`;
    case 'shopper':
      return `notifications:${reader.organizationId}:customer:${reader.customerId}`;
  }
}

/** Publish each reader's new unread count. Never throws. */
export async function announceListChanged(readers: Reader[]): Promise<void> {
  if (!ablyConfigured() || readers.length === 0) return;
  await Promise.all(
    readers.map(async (reader) => {
      try {
        const event: ListEvent = { unread: await unreadCount(reader) };
        await publishHint(listChannelName(reader), event, 'a notification list');
      } catch (error) {
        console.error('[notifications] Couldn’t announce a list change:', error);
      }
    }),
  );
}
