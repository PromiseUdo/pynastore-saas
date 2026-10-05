/*
 * lib/mobile/push/watch.ts
 *
 * "Turn on notifications" for an order, from inside a store's own app
 * (ROADMAP 16.4). Server only.
 *
 * Everything is decided from the request, never from the browser's say-so:
 * the store from the page's tenant, the app and the phone from the user
 * agent, the order from its confirmation token within that store. A device
 * is only ever linked to orders it asked about, and only for 60 days.
 */
import { prisma } from '@/lib/prisma';
import { appIdFromUserAgent, pushPlatformFromUserAgent, userAgentHasPush } from '../app-config';
import { mobileAppForUserAgent } from '../store-apps';
import { fcmConfigured } from './fcm';
import { isPlausiblePushToken } from './messages';

/** How long a device keeps hearing about an order it asked about. */
export const WATCH_DAYS = 60;

/**
 * Whether to offer notifications on this request at all: a store's own app,
 * built with push, for this store, on a phone we hold credentials to reach.
 */
export async function pushReadyFor(userAgent: string | null | undefined, organizationSlug: string): Promise<boolean> {
  if (!userAgentHasPush(userAgent)) return false;
  const platform = pushPlatformFromUserAgent(userAgent);
  const appId = appIdFromUserAgent(userAgent);
  if (!platform || !appId) return false;

  const app = await mobileAppForUserAgent(userAgent);
  if (app.mode !== 'branded' || app.lockedSlug !== organizationSlug) return false;

  if (platform === 'ANDROID') return fcmConfigured();
  const record = await prisma.mobileApp.findUnique({
    where: { appId },
    select: { apnsTeamId: true, apnsKeyId: true, apnsKeySealed: true },
  });
  return Boolean(record?.apnsTeamId && record.apnsKeyId && record.apnsKeySealed);
}

export type WatchResult = 'watching' | 'unavailable' | 'not-found' | 'invalid-token';

export async function watchOrder(input: {
  organizationSlug: string;
  confirmationToken: string;
  deviceToken: string;
  userAgent: string | null | undefined;
}): Promise<WatchResult> {
  if (!(await pushReadyFor(input.userAgent, input.organizationSlug))) return 'unavailable';
  const platform = pushPlatformFromUserAgent(input.userAgent)!;
  const appId = appIdFromUserAgent(input.userAgent)!;

  const deviceToken = input.deviceToken.trim();
  if (!isPlausiblePushToken(platform, deviceToken)) return 'invalid-token';

  const order = await prisma.order.findFirst({
    where: {
      confirmationToken: input.confirmationToken,
      organization: { slug: input.organizationSlug, status: 'ACTIVE' },
    },
    select: { id: true, organizationId: true },
  });
  if (!order) return 'not-found';

  const device = await prisma.pushDevice.upsert({
    where: { appId_token: { appId, token: deviceToken } },
    create: { organizationId: order.organizationId, appId, platform, token: deviceToken },
    update: { organizationId: order.organizationId, platform, lastSeenAt: new Date() },
    select: { id: true },
  });
  await prisma.pushOrderWatch.upsert({
    where: { deviceId_orderId: { deviceId: device.id, orderId: order.id } },
    create: { deviceId: device.id, orderId: order.id },
    update: {},
  });
  return 'watching';
}

/** Daily (data retention): watches past their 60 days, and devices left watching nothing. */
export async function purgeOldPushWatches(now = new Date()): Promise<{ watches: number; devices: number }> {
  const cutoff = new Date(now.getTime() - WATCH_DAYS * 86_400_000);
  const watches = await prisma.pushOrderWatch.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const devices = await prisma.pushDevice.deleteMany({ where: { lastSeenAt: { lt: cutoff }, watches: { none: {} } } });
  return { watches: watches.count, devices: devices.count };
}
