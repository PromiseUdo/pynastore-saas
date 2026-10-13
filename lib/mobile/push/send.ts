/*
 * lib/mobile/push/send.ts
 *
 * Sending to one phone in a store's own app (ROADMAP 16.4, 18.4): FCM for
 * Android, APNs with the store app's own key for iOS. Server only. A phone in
 * the business app (ROADMAP 19.4) is the platform's own app: Android through
 * the same Firebase project, iPhone with the PLATFORM's APNs key (env).
 *
 * Who is told, and when, is decided by lib/notifications (ROADMAP 18); this
 * is the native channel's transport (lib/notifications/channels/
 * native-push.ts) and the badge's (lib/notifications/badges.ts). Tapping a
 * notification opens `data.path` in the app (components/native/native-shell.tsx).
 *
 * An iPhone build run from Xcode registers with Apple's test service. The
 * app can't reliably tell which kind of build it is, so the live service is
 * tried first; if it doesn't know the token, the test service is tried, and
 * a success there is reported (`sandbox: true`) for the caller to remember
 * on the device.
 */
import { prisma } from '@/lib/prisma';
import { open } from '@/lib/social/crypto';
import { sendFcm, type SendOutcome } from './fcm';
import { sendApns, type ApnsCredentials } from './apns';
import type { PushMessage } from './messages';
import { BUSINESS_APP_ID } from '../app-config';

export interface PushTarget {
  /** null for a phone in the business app, which belongs to a person, not a shop */
  organizationId: string | null;
  appId: string;
  platform: 'ANDROID' | 'IOS';
  token: string;
  apnsSandbox?: boolean;
}

export interface DeviceSend {
  /** 'no-credentials': an iPhone app with no APNs key recorded, so trying again won't help */
  outcome: SendOutcome | 'no-credentials';
  /** this iPhone turned out to use Apple's test service; remember it */
  sandbox?: boolean;
}

export async function sendToDevice(
  device: PushTarget,
  message: PushMessage | null,
  data: Record<string, string>,
  options: { badge?: number; thread?: string } = {},
): Promise<DeviceSend> {
  if (device.platform === 'ANDROID') {
    // Android shows its own dot on the icon for notifications in the tray; nothing to send for a badge alone.
    if (!message) return { outcome: 'sent' };
    return { outcome: await sendFcm(device.token, message, data, { thread: options.thread }) };
  }

  const credentials = await apnsCredentials(device.organizationId, device.appId);
  if (!credentials) return { outcome: 'no-credentials' };

  const first = await sendApns(device.token, message, data, credentials, { ...options, sandbox: device.apnsSandbox });
  if (first !== 'bad-token') return { outcome: first };
  if (device.apnsSandbox) return { outcome: 'gone' };

  const sandbox = await sendApns(device.token, message, data, credentials, { ...options, sandbox: true });
  if (sandbox === 'sent') return { outcome: 'sent', sandbox: true };
  return { outcome: sandbox === 'failed' ? 'failed' : 'gone' };
}

/**
 * The business app's APNs key (ROADMAP 19.4): the platform's own, from
 * APNS_BUSINESS_KEY (the .p8's contents, real or escaped line breaks),
 * APNS_BUSINESS_KEY_ID and APNS_BUSINESS_TEAM_ID. Null until all three are set.
 */
export function businessApnsCredentials(): ApnsCredentials | null {
  const key = process.env.APNS_BUSINESS_KEY?.trim().replace(/\\n/g, '\n');
  const keyId = process.env.APNS_BUSINESS_KEY_ID?.trim();
  const teamId = process.env.APNS_BUSINESS_TEAM_ID?.trim();
  return key && keyId && teamId ? { teamId, keyId, key, topic: BUSINESS_APP_ID } : null;
}

async function apnsCredentials(organizationId: string | null, appId: string): Promise<ApnsCredentials | null> {
  if (appId === BUSINESS_APP_ID) return businessApnsCredentials();
  if (!organizationId) return null;
  const app = await prisma.mobileApp.findFirst({
    where: { organizationId, appId },
    select: { apnsTeamId: true, apnsKeyId: true, apnsKeySealed: true },
  });
  return app?.apnsTeamId && app.apnsKeyId && app.apnsKeySealed
    ? { teamId: app.apnsTeamId, keyId: app.apnsKeyId, key: open(app.apnsKeySealed), topic: appId }
    : null;
}
