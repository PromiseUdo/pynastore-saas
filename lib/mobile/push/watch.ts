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
 *
 * And the device's owner (ROADMAP 18.4): whoever is signed in when it asks.
 * A signed-in shopper's phone then hears everything that's theirs — every
 * order, every reply — with one "yes"; a guest's (or one whose shopper has
 * signed out) belongs to nobody and hears only what it watches.
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

/**
 * Record this phone for a store, owned by `customerId` (the signed-in
 * shopper) or nobody. Assumes pushReadyFor has said yes. Null when the token
 * isn't one the platform would issue.
 */
export async function linkDevice(input: {
  organizationId: string;
  deviceToken: string;
  userAgent: string | null | undefined;
  customerId: string | null;
}): Promise<{ id: string } | null> {
  const platform = pushPlatformFromUserAgent(input.userAgent);
  const appId = appIdFromUserAgent(input.userAgent);
  const token = input.deviceToken.trim();
  if (!platform || !appId || !isPlausiblePushToken(platform, token)) return null;
  const owner = { organizationId: input.organizationId, platform, customerId: input.customerId };
  return prisma.pushDevice.upsert({
    where: { appId_token: { appId, token } },
    create: { ...owner, appId, token },
    update: { ...owner, lastSeenAt: new Date() },
    select: { id: true },
  });
}

export async function watchOrder(input: {
  organizationSlug: string;
  confirmationToken: string;
  deviceToken: string;
  userAgent: string | null | undefined;
  /** the signed-in shopper asking, if any: the phone becomes theirs */
  customerId?: string | null;
}): Promise<WatchResult> {
  if (!(await pushReadyFor(input.userAgent, input.organizationSlug))) return 'unavailable';
  const platform = pushPlatformFromUserAgent(input.userAgent)!;
  if (!isPlausiblePushToken(platform, input.deviceToken.trim())) return 'invalid-token';

  const order = await prisma.order.findFirst({
    where: {
      confirmationToken: input.confirmationToken,
      organization: { slug: input.organizationSlug, status: 'ACTIVE' },
    },
    select: { id: true, organizationId: true },
  });
  if (!order) return 'not-found';

  const device = await linkDevice({ ...input, organizationId: order.organizationId, customerId: input.customerId ?? null });
  if (!device) return 'invalid-token';
  await prisma.pushOrderWatch.upsert({
    where: { deviceId_orderId: { deviceId: device.id, orderId: order.id } },
    create: { deviceId: device.id, orderId: order.id },
    update: {},
  });
  return 'watching';
}

/**
 * "Notifications on this phone" from the shopper's account (ROADMAP 18.4):
 * on links the phone to the signed-in shopper, off forgets the phone for
 * this store altogether (and what it watched).
 */
export async function setAccountPhone(input: {
  organizationSlug: string;
  deviceToken: string;
  userAgent: string | null | undefined;
  customerId: string;
  on: boolean;
}): Promise<'on' | 'off' | 'unavailable' | 'invalid-token'> {
  if (!(await pushReadyFor(input.userAgent, input.organizationSlug))) return 'unavailable';
  const store = await prisma.organization.findFirst({ where: { slug: input.organizationSlug, status: 'ACTIVE' }, select: { id: true } });
  if (!store) return 'unavailable';
  if (input.on) {
    return (await linkDevice({ ...input, organizationId: store.id })) ? 'on' : 'invalid-token';
  }
  const appId = appIdFromUserAgent(input.userAgent)!;
  await prisma.pushDevice.deleteMany({ where: { organizationId: store.id, appId, token: input.deviceToken.trim(), customerId: input.customerId } });
  return 'off';
}

/** Daily (data retention): watches past their 60 days, and devices left watching nothing. */
export async function purgeOldPushWatches(now = new Date()): Promise<{ watches: number; devices: number }> {
  const cutoff = new Date(now.getTime() - WATCH_DAYS * 86_400_000);
  const watches = await prisma.pushOrderWatch.deleteMany({ where: { createdAt: { lt: cutoff } } });
  // A phone that only watches a chat (ROADMAP 17.4), or belongs to a shopper's
  // account (18.4), still has something to hear about.
  const devices = await prisma.pushDevice.deleteMany({
    where: { lastSeenAt: { lt: cutoff }, customerId: null, watches: { none: {} }, chatWatches: { none: {} } },
  });
  return { watches: watches.count, devices: devices.count };
}
