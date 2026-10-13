/*
 * lib/notifications/badges.ts
 *
 * Keeping the number on a store app's icon — and the business app's (19.4) — true (ROADMAP 18.4). A push sets
 * it to the shopper's unread count (./channels/native-push.ts); when they
 * read their notifications, this sends their iPhones a badge-only update
 * (nothing shown, nothing heard) so the icon doesn't keep counting what
 * they've seen. Android's dot follows the notifications in the tray by
 * itself. Server only; never throws.
 */
import { prisma } from '@/lib/prisma';
import { sendToDevice } from '@/lib/mobile/push/send';
import { BUSINESS_APP_ID } from '@/lib/mobile/app-config';
import { staffUnreadEverywhere, unreadCount, type Reader } from './readers';

export async function syncAppBadges(reader: Reader): Promise<void> {
  if (reader.kind === 'platform') return;
  try {
    // A shopper's phones in this store's app; a staff member's in the business app (ROADMAP 19.4).
    const devices = await prisma.pushDevice.findMany({
      where:
        reader.kind === 'shopper'
          ? { organizationId: reader.organizationId, customerId: reader.customerId, platform: 'IOS' }
          : { userId: reader.userId, appId: BUSINESS_APP_ID, platform: 'IOS' },
      select: { id: true, organizationId: true, appId: true, platform: true, token: true, apnsSandbox: true },
    });
    if (devices.length === 0) return;
    // The business app is one app for every shop: its number counts them all.
    const badge = reader.kind === 'shopper' ? await unreadCount(reader) : await staffUnreadEverywhere(reader.userId);
    await Promise.all(
      devices.map(async (device) => {
        const sent = await sendToDevice(device, null, {}, { badge }).catch(() => null);
        if (sent?.outcome === 'gone') await prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => {});
        else if (sent?.sandbox) await prisma.pushDevice.update({ where: { id: device.id }, data: { apnsSandbox: true } }).catch(() => {});
      }),
    );
  } catch (error) {
    console.error('[notifications] Couldn’t update an app badge:', error);
  }
}
