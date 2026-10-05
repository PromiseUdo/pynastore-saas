/*
 * lib/mobile/store-apps.ts
 *
 * Which phone app a request comes from, read against `MobileApp`
 * (ROADMAP 16.1). Server only. The pure parts — the user-agent marker and the
 * routing decision — are in ./app-config.ts.
 */
import { prisma } from '@/lib/prisma';
import { MALL_APP, SHARED_APP_ID, appIdFromUserAgent, isValidAppId, type MobileApp } from './app-config';

/** The app a request on the mobile origin comes from, by its user agent. */
export async function mobileAppForUserAgent(userAgent: string | null | undefined): Promise<MobileApp> {
  const appId = appIdFromUserAgent(userAgent);
  if (!appId || appId === SHARED_APP_ID) return MALL_APP;

  const app = await prisma.mobileApp.findUnique({
    where: { appId },
    select: { status: true, organization: { select: { slug: true } } },
  });

  // A build nobody registered opens nothing — it must not fall back to the mall.
  if (!app) return { mode: 'closed', lockedSlug: null };
  if (app.status !== 'ACTIVE') return { mode: 'closed', lockedSlug: app.organization.slug };
  return { mode: 'branded', lockedSlug: app.organization.slug };
}

/**
 * Whether the platform may deep-link to this app id: the shared app, or a
 * store's app that is registered and ACTIVE. Deep links are never sent to a
 * scheme just because a request named it.
 */
export async function isKnownAppId(appId: string | null | undefined): Promise<boolean> {
  if (!appId || !isValidAppId(appId)) return false;
  if (appId === SHARED_APP_ID) return true;
  const app = await prisma.mobileApp.findFirst({ where: { appId, status: 'ACTIVE' }, select: { id: true } });
  return Boolean(app);
}

/**
 * The URL scheme to hand a shopper back to the app they're using, from the
 * request's user agent: their store's app when it's a known one, otherwise the
 * shared app (which is what every app was before 16.1).
 */
export async function deepLinkSchemeFor(userAgent: string | null | undefined): Promise<string> {
  const appId = appIdFromUserAgent(userAgent);
  return appId && (await isKnownAppId(appId)) ? appId : SHARED_APP_ID;
}
