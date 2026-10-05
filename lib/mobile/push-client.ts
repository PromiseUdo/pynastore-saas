'use client';

/*
 * lib/mobile/push-client.ts
 *
 * Asking the phone for notifications, inside a store's own app (ROADMAP 16.4).
 *
 * Only ever called from a build that has push (its user agent says
 * MansaasPush — app-config.ts), because an Android build without the Firebase
 * config can't register at all. The token goes straight to the server
 * (watchOrderUpdatesAction) and is never kept in the page.
 */
import { userAgentHasPush } from './app-config';
import { isNativePlatform } from '@/lib/platform';

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

export function pushBuiltIn(): boolean {
  return isNativePlatform() && typeof navigator !== 'undefined' && userAgentHasPush(navigator.userAgent);
}

export async function pushPermission(): Promise<PushPermission> {
  if (!pushBuiltIn()) return 'unavailable';
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const { receive } = await PushNotifications.checkPermissions();
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'prompt';
}

/** Ask (if not yet asked) and register. Resolves with the device token, or null when refused. */
export async function registerForPush(): Promise<string | null> {
  if (!pushBuiltIn()) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');

  let { receive } = await PushNotifications.checkPermissions();
  if (receive !== 'granted' && receive !== 'denied') ({ receive } = await PushNotifications.requestPermissions());
  if (receive !== 'granted') return null;

  return new Promise<string | null>((resolve) => {
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];
    const done = (token: string | null) => {
      clearTimeout(timer);
      for (const handle of handles) void handle.then((h) => h.remove());
      resolve(token);
    };
    const timer = setTimeout(() => done(null), 15_000);
    handles.push(PushNotifications.addListener('registration', ({ value }) => done(value)));
    handles.push(PushNotifications.addListener('registrationError', () => done(null)));
    void PushNotifications.register().catch(() => done(null));
  });
}
