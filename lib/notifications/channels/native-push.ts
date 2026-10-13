/*
 * lib/notifications/channels/native-push.ts
 *
 * The phone channel (ROADMAP 18.1): one delivery is one device in a store's
 * own app. The transport is lib/mobile/push/send.ts; this reads the device
 * fresh at send time (a retry may come after the token changed or the app
 * was uninstalled) and forgets one the platform calls dead.
 */
import { prisma } from '@/lib/prisma';
import { sendToDevice } from '@/lib/mobile/push/send';
import type { ChannelOutcome } from './outcome';

export interface NativePushPayload {
  title: string;
  body: string;
  /** opened in the app when tapped: a path on the mobile origin, /s/{slug}/… */
  path: string;
}

export async function sendNativePush(deviceId: string, payload: NativePushPayload): Promise<ChannelOutcome> {
  const device = await prisma.pushDevice.findUnique({
    where: { id: deviceId },
    select: { organizationId: true, appId: true, platform: true, token: true },
  });
  if (!device) return 'gone';

  let outcome: Awaited<ReturnType<typeof sendToDevice>>;
  try {
    outcome = await sendToDevice(device, { title: payload.title, body: payload.body }, { path: payload.path });
  } catch (error) {
    console.error('[notifications] Could not reach a phone:', error);
    return 'retry';
  }

  if (outcome === 'sent') return 'sent';
  if (outcome === 'gone') {
    // Its watches go with it (cascade).
    await prisma.pushDevice.delete({ where: { id: deviceId } }).catch(() => {});
    return 'gone';
  }
  // No APNs key recorded: trying again won't change that.
  return outcome === 'no-credentials' ? 'failed' : 'retry';
}
