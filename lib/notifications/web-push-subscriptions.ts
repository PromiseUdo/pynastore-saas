/*
 * lib/notifications/web-push-subscriptions.ts
 *
 * Browsers that asked for notifications (ROADMAP 18.3). Server only.
 *
 * A subscription is saved against WHO the server sees on that request — a
 * member in a shop, platform staff, a signed-in shopper, or a guest (their
 * chat cookie, or the one order they asked about) — never against an id the
 * browser sends. The same browser subscribing again (it keeps its endpoint)
 * moves to whoever is signed in now, which is who should hear on it.
 *
 * Only real push services are accepted as endpoints: our server POSTs to
 * whatever is saved here, so an arbitrary URL would let anyone make it call
 * any address they like.
 */
import { prisma } from '@/lib/prisma';
import type { NotificationAudience } from '@/lib/generated/prisma/enums';
import { WATCH_DAYS } from '@/lib/mobile/push/watch';
import type { BrowserView } from './view';

export interface BrowserOwner {
  audience: NotificationAudience;
  organizationId: string | null;
  userId?: string | null;
  customerId?: string | null;
  /** a guest in a chat: their chat cookie, hashed (lib/chat/identity.ts) */
  guestKeyHash?: string | null;
}

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The push services browsers use: Chrome/Edge/Android, Firefox, Safari, legacy Edge. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** A browser's PushSubscription.toJSON(), checked; null if it isn't one we'd send to. */
export function parseSubscription(input: unknown): SubscriptionInput | null {
  if (!input || typeof input !== 'object') return null;
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port || !PUSH_HOSTS.some((host) => host.test(url.hostname))) return null;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== 'string' || p256dh.length < 80 || p256dh.length > 100 || !BASE64URL.test(p256dh)) return null;
  if (typeof auth !== 'string' || auth.length < 16 || auth.length > 32 || !BASE64URL.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/** "Chrome on Android", for the person's list of devices. Pure. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'A browser';
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  return system ? `${browser} on ${system}` : browser;
}

const ownerFields = (owner: BrowserOwner) => ({
  audience: owner.audience,
  organizationId: owner.organizationId,
  userId: owner.userId ?? null,
  customerId: owner.customerId ?? null,
  guestKeyHash: owner.guestKeyHash ?? null,
});

/** Save (or move) a browser's subscription; optionally have it watch one order. Returns its id. */
export async function saveSubscription(
  owner: BrowserOwner,
  subscription: SubscriptionInput,
  context: { origin: string; userAgent: string | null; orderId?: string | null },
): Promise<string> {
  const data = { ...ownerFields(owner), p256dh: subscription.p256dh, auth: subscription.auth, origin: context.origin, label: deviceLabel(context.userAgent) };
  const saved = await prisma.webPushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: { endpoint: subscription.endpoint, ...data },
    update: { ...data, lastSeenAt: new Date() },
    select: { id: true },
  });
  if (context.orderId) {
    await prisma.webPushOrderWatch.upsert({
      where: { subscriptionId_orderId: { subscriptionId: saved.id, orderId: context.orderId } },
      create: { subscriptionId: saved.id, orderId: context.orderId },
      update: {},
    });
  }
  return saved.id;
}

/** The rows that are this owner's. A browser's id or endpoint is only ever used with this. */
function ownedBy(owner: BrowserOwner) {
  return {
    audience: owner.audience,
    organizationId: owner.organizationId,
    ...(owner.userId ? { userId: owner.userId } : owner.customerId ? { customerId: owner.customerId } : { userId: null, customerId: null }),
  };
}

/** Stop notifications on one browser: by its endpoint (this browser) or id (from the list). */
export async function removeSubscription(owner: BrowserOwner, which: { endpoint?: string; id?: string }): Promise<boolean> {
  if (!which.endpoint && !which.id) return false;
  const removed = await prisma.webPushSubscription.deleteMany({
    where: { ...ownedBy(owner), ...(which.endpoint ? { endpoint: which.endpoint } : { id: which.id }) },
  });
  return removed.count > 0;
}

export type { BrowserView } from './view';

/** A signed-in person's browsers. A guest has no list. */
export async function listBrowsers(owner: BrowserOwner): Promise<BrowserView[]> {
  if (!owner.userId && !owner.customerId) return [];
  const rows = await prisma.webPushSubscription.findMany({
    where: ownedBy(owner),
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, endpoint: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** Daily (data retention): browsers' order watches past their 60 days, and guest browsers left watching nothing. */
export async function purgeOldBrowserWatches(now = new Date()): Promise<{ watches: number; browsers: number }> {
  const cutoff = new Date(now.getTime() - WATCH_DAYS * 86_400_000);
  const watches = await prisma.webPushOrderWatch.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const browsers = await prisma.webPushSubscription.deleteMany({
    where: { audience: 'SHOPPER', userId: null, customerId: null, guestKeyHash: null, lastSeenAt: { lt: cutoff }, orderWatches: { none: {} } },
  });
  return { watches: watches.count, browsers: browsers.count };
}
