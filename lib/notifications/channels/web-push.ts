/*
 * lib/notifications/channels/web-push.ts
 *
 * The browser channel (ROADMAP 18.1, used from 18.3): standard Web Push
 * with the platform's own VAPID keys — no Firebase, no third-party script —
 * so it works in every browser and on every host we serve, custom domains
 * included. One key pair serves every origin.
 *
 *   NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY   the public key (the browser needs it)
 *   WEB_PUSH_PRIVATE_KEY              the private key
 *   WEB_PUSH_SUBJECT                  mailto: or https: contact for push services
 *
 * Generate once with `npx web-push generate-vapid-keys`. Changing them
 * later orphans every browser's subscription. Unset = browsers are never
 * offered notifications.
 */
import webpush, { WebPushError } from 'web-push';
import { prisma } from '@/lib/prisma';
import type { ChannelOutcome } from './outcome';

export interface WebPushPayload {
  title: string;
  body: string;
  /** opened when clicked: an absolute URL on the subscription's own origin */
  url: string;
  /** notifications with the same tag replace each other */
  tag?: string;
}

/** How long a push service keeps trying a browser that's offline. */
const TTL_SECONDS = 24 * 3600;

function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export function webPushConfigured(): boolean {
  return vapid() !== null;
}

export async function sendWebPush(subscriptionId: string, payload: WebPushPayload): Promise<ChannelOutcome> {
  const subscription = await prisma.webPushSubscription.findUnique({
    where: { id: subscriptionId },
    select: { endpoint: true, p256dh: true, auth: true },
  });
  if (!subscription) return 'gone';
  const keys = vapid();
  if (!keys) return 'failed';

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { vapidDetails: keys, TTL: TTL_SECONDS, urgency: 'high' },
    );
    return 'sent';
  } catch (error) {
    const status = error instanceof WebPushError ? error.statusCode : null;
    // The browser unsubscribed or the subscription expired.
    if (status === 404 || status === 410) {
      await prisma.webPushSubscription.delete({ where: { id: subscriptionId } }).catch(() => {});
      return 'gone';
    }
    console.error(`[notifications] Web push failed (${status ?? 'no response'}):`, error instanceof Error ? error.message : error);
    // No answer, too many requests, or the push service's own trouble: later.
    if (status === null || status === 429 || status >= 500) return 'retry';
    return 'failed';
  }
}
