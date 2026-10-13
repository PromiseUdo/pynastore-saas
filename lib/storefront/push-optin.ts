'use client';

/*
 * lib/storefront/push-optin.ts
 *
 * One "turn on notifications" for a shopper, whichever way they can get
 * them (ROADMAP 16.4, 17.4, 18.3):
 *
 *   app      inside a store's own app: the phone's notifications
 *            (lib/mobile/push-client.ts), linked by the caller's own action
 *   browser  on the shop's website: Web Push (lib/notifications/web-push-client.ts),
 *            through /api/storefront/notifications/web-push
 *
 * The server decides which one a page offers (the app can be reached, or
 * the platform's browser keys are set); the browser then says whether it
 * really can.
 */
import { pushPermission, registerForPush } from '@/lib/mobile/push-client';
import { turnOnWebPush, webPushSupport } from '@/lib/notifications/web-push-client';

export type PushChannel = 'app' | 'browser';
export type OptInPermission = 'granted' | 'prompt' | 'denied' | 'unavailable';

export const STOREFRONT_WEB_PUSH_ROUTE = '/api/storefront/notifications/web-push';

export async function optInPermission(channel: PushChannel): Promise<OptInPermission> {
  if (channel === 'app') return pushPermission().catch(() => 'unavailable' as const);
  // An iPhone shopper would have to install the shop first; not for one order or one chat.
  if (webPushSupport() !== 'ready') return 'unavailable';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.permission === 'denied' ? 'denied' : 'prompt';
}

/**
 * Ask (from a click, or quietly when already allowed) and link this phone or
 * browser. `linkApp` hands the phone's token to the caller's server action;
 * `browserExtra` goes with a browser's subscription (a guest's order token).
 */
export async function optIn(
  channel: PushChannel,
  linkApp: (deviceToken: string) => Promise<boolean>,
  browserExtra: Record<string, unknown> = {},
): Promise<'on' | 'blocked' | 'failed'> {
  if (channel === 'browser') return turnOnWebPush(STOREFRONT_WEB_PUSH_ROUTE, browserExtra);
  const token = await registerForPush().catch(() => null);
  if (!token) return (await pushPermission().catch(() => 'unavailable')) === 'denied' ? 'blocked' : 'failed';
  return (await linkApp(token).catch(() => false)) ? 'on' : 'failed';
}
