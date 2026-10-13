/*
 * lib/mobile/push/send.ts
 *
 * Sending one notification to one phone in a store's own app (ROADMAP
 * 16.4): FCM for Android, APNs with the store app's own key for iOS. Server
 * only.
 *
 * Who is told, and when, is decided by lib/notifications (ROADMAP 18); this
 * is the native channel's transport (lib/notifications/channels/
 * native-push.ts). Tapping the notification opens `data.path` in the app
 * (components/native/native-shell.tsx).
 */
import { prisma } from '@/lib/prisma';
import { open } from '@/lib/social/crypto';
import { sendFcm, type SendOutcome } from './fcm';
import { sendApns, type ApnsCredentials } from './apns';
import type { PushMessage } from './messages';

export interface PushTarget {
  organizationId: string;
  appId: string;
  platform: 'ANDROID' | 'IOS';
  token: string;
}

/**
 * 'gone' means the platform says the token is dead; 'no-credentials' that
 * an iPhone app has no APNs key recorded, so trying again won't help.
 */
export async function sendToDevice(
  device: PushTarget,
  message: PushMessage,
  data: Record<string, string>,
): Promise<SendOutcome | 'no-credentials'> {
  if (device.platform === 'ANDROID') return sendFcm(device.token, message, data);

  const credentials = await apnsCredentials(device.organizationId, device.appId);
  if (!credentials) return 'no-credentials';
  return sendApns(device.token, message, data, credentials);
}

async function apnsCredentials(organizationId: string, appId: string): Promise<ApnsCredentials | null> {
  const app = await prisma.mobileApp.findFirst({
    where: { organizationId, appId },
    select: { apnsTeamId: true, apnsKeyId: true, apnsKeySealed: true },
  });
  return app?.apnsTeamId && app.apnsKeyId && app.apnsKeySealed
    ? { teamId: app.apnsTeamId, keyId: app.apnsKeyId, key: open(app.apnsKeySealed), topic: appId }
    : null;
}
