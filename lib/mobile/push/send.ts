/*
 * lib/mobile/push/send.ts
 *
 * Telling the phones that asked about an order that it changed
 * (ROADMAP 16.4), and the shared sending they and chat replies (17.4) go
 * through. Server only.
 *
 * Called beside the order email (lib/storefront/orders/notifications.ts),
 * after the change has committed, and never allowed to fail it: every error
 * is logged and swallowed. A token the platform says is dead is deleted.
 *
 * Tapping the notification opens the order's page in the app (`path`, read
 * by components/native/native-shell.tsx).
 */
import { prisma } from '@/lib/prisma';
import type { OrderEmailKind } from '@/emails/storefront-order-update';
import { open } from '@/lib/social/crypto';
import { orderPushMessage } from './messages';
import { sendFcm, type SendOutcome } from './fcm';
import { sendApns, type ApnsCredentials } from './apns';
import type { PushMessage } from './messages';
import { WATCH_DAYS } from './watch';

export async function pushOrderUpdate(orderId: string, kind: OrderEmailKind): Promise<{ sent: number; gone: number; failed: number }> {
  const tally = { sent: 0, gone: 0, failed: 0 };
  try {
    const since = new Date(Date.now() - WATCH_DAYS * 86_400_000);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        reference: true,
        confirmationToken: true,
        organizationId: true,
        organization: { select: { name: true, slug: true } },
        pushWatches: {
          where: { createdAt: { gte: since } },
          select: { device: { select: { id: true, appId: true, platform: true, token: true } } },
        },
      },
    });
    if (!order?.confirmationToken || order.pushWatches.length === 0) return tally;

    const message = orderPushMessage(kind, { storeName: order.organization.name, reference: order.reference });
    if (!message) return tally;

    // The store's app is opened on the mobile origin under /s/{slug}.
    const data = {
      path: `/s/${order.organization.slug}/checkout/confirmation?t=${encodeURIComponent(order.confirmationToken)}`,
    };

    const result = await sendToDevices(
      order.organizationId,
      order.pushWatches.map((w) => w.device),
      message,
      data,
      `order ${orderId}`,
    );
    Object.assign(tally, result);
  } catch (error) {
    console.error(`[push] Could not notify devices about order ${orderId} (${kind}):`, error);
  }
  return tally;
}

export interface PushTarget {
  id: string;
  appId: string;
  platform: 'ANDROID' | 'IOS';
  token: string;
}

export type PushTally = { sent: number; gone: number; failed: number };

/**
 * Send one message to some of a store's devices: FCM for Android, APNs with
 * the store app's own key for iOS. Never throws. A token the platform calls
 * dead is deleted, so it isn't tried again. `what` only labels the log.
 */
export async function sendToDevices(
  organizationId: string,
  devices: PushTarget[],
  message: PushMessage,
  data: Record<string, string>,
  what: string,
): Promise<PushTally> {
  const tally: PushTally = { sent: 0, gone: 0, failed: 0 };

  let apns: ApnsCredentials | null | undefined;
  const apnsCredentials = async (appId: string): Promise<ApnsCredentials | null> => {
    if (apns !== undefined) return apns;
    const app = await prisma.mobileApp.findFirst({
      where: { organizationId, appId },
      select: { apnsTeamId: true, apnsKeyId: true, apnsKeySealed: true },
    });
    apns =
      app?.apnsTeamId && app.apnsKeyId && app.apnsKeySealed
        ? { teamId: app.apnsTeamId, keyId: app.apnsKeyId, key: open(app.apnsKeySealed), topic: appId }
        : null;
    return apns;
  };

  for (const device of devices) {
    let outcome: SendOutcome = 'failed';
    try {
      if (device.platform === 'ANDROID') {
        outcome = await sendFcm(device.token, message, data);
      } else {
        const credentials = await apnsCredentials(device.appId);
        outcome = credentials ? await sendApns(device.token, message, data, credentials) : 'failed';
      }
    } catch (error) {
      console.error(`[push] Could not send to a device for ${what}:`, error);
    }
    tally[outcome] += 1;
    if (outcome === 'gone') await prisma.pushDevice.delete({ where: { id: device.id } }).catch(() => {});
  }
  return tally;
}
