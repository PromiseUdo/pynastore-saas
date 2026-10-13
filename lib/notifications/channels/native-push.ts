/*
 * lib/notifications/channels/native-push.ts
 *
 * The phone channel (ROADMAP 18.1, 18.4): one delivery is one device in a
 * store's own app. The transport is lib/mobile/push/send.ts; this reads the
 * device fresh at send time (a retry may come after the token changed or the
 * app was uninstalled), forgets one the platform calls dead, and remembers
 * an iPhone that turned out to use Apple's test service.
 *
 * A phone linked to a signed-in shopper's account shows their unread count
 * on the app's icon (iPhone); a guest's phone has no list, so no number.
 */
import { prisma } from '@/lib/prisma';
import { sendToDevice } from '@/lib/mobile/push/send';
import { unreadCount } from '../readers';
import type { ChannelOutcome } from './outcome';

export interface NativePushPayload {
  title: string;
  body: string;
  /** opened in the app when tapped: a path on the mobile origin, /s/{slug}/… */
  path: string;
  /** notifications about the same thing replace each other ("order:{id}") */
  thread?: string;
}

export async function sendNativePush(deviceId: string, payload: NativePushPayload): Promise<ChannelOutcome> {
  const device = await prisma.pushDevice.findUnique({
    where: { id: deviceId },
    select: { organizationId: true, appId: true, platform: true, token: true, apnsSandbox: true, customerId: true },
  });
  if (!device) return 'gone';

  const badge =
    device.platform === 'IOS' && device.customerId
      ? await unreadCount({ kind: 'shopper', customerId: device.customerId, organizationId: device.organizationId })
      : undefined;

  let sent: Awaited<ReturnType<typeof sendToDevice>>;
  try {
    sent = await sendToDevice(device, { title: payload.title, body: payload.body }, { path: payload.path }, { badge, thread: payload.thread });
  } catch (error) {
    console.error('[notifications] Could not reach a phone:', error);
    return 'retry';
  }

  if (sent.sandbox) await prisma.pushDevice.update({ where: { id: deviceId }, data: { apnsSandbox: true } }).catch(() => {});
  if (sent.outcome === 'sent') return 'sent';
  if (sent.outcome === 'gone') {
    // Its watches go with it (cascade).
    await prisma.pushDevice.delete({ where: { id: deviceId } }).catch(() => {});
    return 'gone';
  }
  // No APNs key recorded: trying again won't change that.
  return sent.outcome === 'no-credentials' ? 'failed' : 'retry';
}
