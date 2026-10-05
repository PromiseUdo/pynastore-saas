'use server';

/*
 * features/platform/mobile-apps.ts
 *
 * The staff side of stores' own apps (ROADMAP 16.2): the queue of apps to
 * build, oldest paid first; one order with everything the engineer needs;
 * and the steps — building, delivered (files handed over), live (listings
 * recorded) — plus switching an app off or back on by hand. Platform staff
 * only.
 *
 * Each step is recorded on the MERCHANT's activity log (like domains and
 * verification), and the merchant is emailed when there's something for them
 * to do or see.
 */
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { createAuditLog } from '@/lib/audit';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getAdminUrl } from '@/lib/tenant/urls';
import { ownerEmails } from '@/lib/org-owners';
import { isValidAppId, SHARED_APP_ID } from '@/lib/mobile/app-config';
import { isAppStoreId } from '@/lib/mobile/listing-rules';
import { appIconPngUrl } from '@/lib/mobile/icon';
import { appDeliveredEmail, appLiveEmail } from '@/lib/mobile/emails';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export type AppQueueTab = 'TO_BUILD' | 'DELIVERED' | 'LIVE' | 'UNPAID' | 'SWITCHED_OFF' | 'ALL';

export interface AppQueueRow {
  id: string;
  appName: string;
  shopName: string;
  stage: string;
  status: string;
  graceEndsAt: Date | null;
  platforms: { android: boolean; ios: boolean };
  /** when it became work: paid, or requested for an unpaid one */
  since: Date;
  paidThrough: Date | null;
}

export interface AppQueuePage {
  rows: AppQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<'TO_BUILD' | 'DELIVERED' | 'LIVE' | 'UNPAID' | 'SWITCHED_OFF', number>;
}

export interface AppOrderDetail {
  id: string;
  appId: string;
  appIdLocked: boolean;
  name: string;
  stage: string;
  status: string;
  icon: { url: string; pngUrl: string } | null;
  backgroundColor: string | null;
  shortDescription: string | null;
  platforms: { android: boolean; ios: boolean };
  dates: { requested: Date; paid: Date | null; building: Date | null; delivered: Date | null; live: Date | null };
  delivery: { versionName: string | null; buildNumber: number | null; downloadUrl: string | null; note: string | null };
  listing: { appStoreId: string | null; onGooglePlay: boolean; promoteOnWebsite: boolean };
  renewal: { paidThrough: Date | null; graceEndsAt: Date | null };
  iosPush: boolean;
  payments: { kind: string; amount: number; paidAt: Date | null; reference: string }[];
  organization: { id: string; name: string; slug: string };
}

const PAGE_SIZE = 25;

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') return { success: false, error: 'Only platform staff can do this' };
  console.error(`[platform/mobile-apps] ${fallback}:`, error);
  return { success: false, error: fallback };
}

const whereFor = (tab: AppQueueTab) =>
  tab === 'TO_BUILD'
    ? { stage: { in: ['PAID', 'BUILDING'] as ('PAID' | 'BUILDING')[] } }
    : tab === 'DELIVERED'
      ? { stage: 'DELIVERED' as const, status: 'ACTIVE' as const }
      : tab === 'LIVE'
        ? { stage: 'LIVE' as const, status: 'ACTIVE' as const }
        : tab === 'UNPAID'
          ? { stage: 'REQUESTED' as const }
          : tab === 'SWITCHED_OFF'
            ? { status: 'LAPSED' as const }
            : {};

/** Apps paid for and not yet built — the console sidebar's badge. */
export async function appsToBuildCount(): Promise<number> {
  await requirePlatformStaff();
  return prisma.mobileApp.count({ where: { stage: 'PAID' } });
}

export async function listAppQueue(params: { tab?: AppQueueTab; page?: number }): Promise<ActionResult<AppQueuePage>> {
  try {
    await requirePlatformStaff();
    const tab = params.tab ?? 'TO_BUILD';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const [rows, total, toBuild, delivered, live, unpaid, off] = await Promise.all([
      prisma.mobileApp.findMany({
        where: whereFor(tab),
        orderBy: tab === 'TO_BUILD' ? [{ paidAt: 'asc' }, { createdAt: 'asc' }] : [{ updatedAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { organization: { select: { name: true } } },
      }),
      prisma.mobileApp.count({ where: whereFor(tab) }),
      prisma.mobileApp.count({ where: whereFor('TO_BUILD') }),
      prisma.mobileApp.count({ where: whereFor('DELIVERED') }),
      prisma.mobileApp.count({ where: whereFor('LIVE') }),
      prisma.mobileApp.count({ where: whereFor('UNPAID') }),
      prisma.mobileApp.count({ where: whereFor('SWITCHED_OFF') }),
    ]);
    return {
      success: true,
      data: {
        rows: rows.map((a) => ({
          id: a.id,
          appName: a.name,
          shopName: a.organization.name,
          stage: a.stage,
          status: a.status,
          graceEndsAt: a.graceEndsAt,
          platforms: { android: a.wantsAndroid, ios: a.wantsIos },
          since: a.paidAt ?? a.createdAt,
          paidThrough: a.paidThrough,
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
        counts: { TO_BUILD: toBuild, DELIVERED: delivered, LIVE: live, UNPAID: unpaid, SWITCHED_OFF: off },
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the store apps');
  }
}

export async function getAppOrder(id: string): Promise<ActionResult<AppOrderDetail | null>> {
  try {
    await requirePlatformStaff();
    const a = await prisma.mobileApp.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        payments: { orderBy: { createdAt: 'desc' }, include: { billingTransaction: { select: { reference: true, status: true } } } },
      },
    });
    if (!a) return { success: true, data: null };
    return {
      success: true,
      data: {
        id: a.id,
        appId: a.appId,
        appIdLocked: a.stage === 'DELIVERED' || a.stage === 'LIVE',
        name: a.name,
        stage: a.stage,
        status: a.status,
        icon: a.iconUrl ? { url: a.iconUrl, pngUrl: appIconPngUrl(a.iconUrl) } : null,
        backgroundColor: a.backgroundColor,
        shortDescription: a.shortDescription,
        platforms: { android: a.wantsAndroid, ios: a.wantsIos },
        dates: { requested: a.createdAt, paid: a.paidAt, building: a.buildingAt, delivered: a.deliveredAt, live: a.liveAt },
        delivery: { versionName: a.versionName, buildNumber: a.buildNumber, downloadUrl: a.downloadUrl, note: a.deliveryNote },
        listing: { appStoreId: a.appStoreId, onGooglePlay: a.onGooglePlay, promoteOnWebsite: a.promoteOnWebsite },
        renewal: { paidThrough: a.paidThrough, graceEndsAt: a.graceEndsAt },
        iosPush: Boolean(a.apnsKeySealed),
        // Only payments Paystack confirmed, or that are still open — abandoned checkouts are noise.
        payments: a.payments
          .filter((p) => p.paidAt || p.billingTransaction.status === 'PENDING')
          .map((p) => ({ kind: p.kind, amount: Number(p.amount), paidAt: p.paidAt, reference: p.billingTransaction.reference })),
        organization: a.organization,
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load that app');
  }
}

async function audit(organizationId: string, userId: string, action: string, appId: string, metadata?: Record<string, string | number | boolean | null>) {
  await createAuditLog({ organizationId, userId, action, entityType: 'MobileApp', entityId: appId, metadata });
}

/** The app id and name, before it's delivered — after that the id is permanent. */
export async function updateAppIdentity(id: string, input: { appId: string; name: string }): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const appId = String(input.appId ?? '').trim().toLowerCase();
    const name = String(input.name ?? '').trim();
    if (!isValidAppId(appId) || appId === SHARED_APP_ID) return { success: false, error: 'Use a reverse-DNS id like com.pynacode.shop.' };
    if (!name || name.length > 30) return { success: false, error: 'The name must be 1 to 30 characters.' };
    const a = await prisma.mobileApp.findUnique({ where: { id }, select: { organizationId: true, appId: true, stage: true } });
    if (!a) return { success: false, error: 'App not found.' };
    if ((a.stage === 'DELIVERED' || a.stage === 'LIVE') && appId !== a.appId) {
      return { success: false, error: 'This app has been delivered, so its id can’t change.' };
    }
    const taken = await prisma.mobileApp.findFirst({ where: { appId, NOT: { id } }, select: { id: true } });
    if (taken) return { success: false, error: `${appId} is already another store’s app.` };
    await prisma.mobileApp.update({ where: { id }, data: { appId, name } });
    await audit(a.organizationId, staff.userId, 'platform.mobile_app.updated', id, { appId, name });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t save that');
  }
}

export async function markAppBuilding(id: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const moved = await prisma.mobileApp.updateMany({
      where: { id, stage: 'PAID' },
      data: { stage: 'BUILDING', buildingAt: new Date(), handledById: staff.userId },
    });
    if (moved.count !== 1) return { success: false, error: 'Only a paid app that isn’t started can be marked as being built.' };
    const a = await prisma.mobileApp.findUniqueOrThrow({ where: { id }, select: { organizationId: true } });
    await audit(a.organizationId, staff.userId, 'platform.mobile_app.building', id);
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t mark it as being built');
  }
}

/** The files are with the merchant: they publish next. Also records a later build of a delivered app. */
export async function markAppDelivered(
  id: string,
  input: { versionName: string; buildNumber: number; downloadUrl: string; note: string },
): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const versionName = String(input.versionName ?? '').trim();
    const note = String(input.note ?? '').trim();
    const downloadUrl = String(input.downloadUrl ?? '').trim();
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(versionName)) return { success: false, error: 'The version looks like 1.0.0 — it’s in the build’s folder name.' };
    if (!Number.isInteger(input.buildNumber) || input.buildNumber < 1) return { success: false, error: 'The build number is a whole number from 1.' };
    if (downloadUrl && !/^https:\/\/\S+$/.test(downloadUrl)) return { success: false, error: 'The download link must start with https://.' };
    if (note.length > 1000) return { success: false, error: 'Keep the note to 1,000 characters.' };

    const a = await prisma.mobileApp.findUnique({
      where: { id },
      include: { organization: { select: { name: true, slug: true } } },
    });
    if (!a) return { success: false, error: 'App not found.' };
    if (a.stage === 'REQUESTED') return { success: false, error: 'This app hasn’t been paid for.' };
    if (a.wantsAndroid && !downloadUrl) return { success: false, error: 'Add the link to the Android files — the merchant needs them to publish.' };

    const firstTime = a.stage === 'PAID' || a.stage === 'BUILDING';
    await prisma.mobileApp.update({
      where: { id },
      data: {
        versionName,
        buildNumber: input.buildNumber,
        downloadUrl: downloadUrl || null,
        deliveryNote: note || null,
        handledById: staff.userId,
        ...(firstTime ? { stage: 'DELIVERED' as const, deliveredAt: new Date(), buildingAt: a.buildingAt ?? new Date() } : {}),
      },
    });
    await audit(a.organizationId, staff.userId, 'platform.mobile_app.delivered', id, { versionName, buildNumber: input.buildNumber });
    if (firstTime) {
      await sendPlatformNoticeEmail({
        to: await ownerEmails(a.organizationId),
        ...appDeliveredEmail({
          shopName: a.organization.name,
          appName: a.name,
          versionName,
          platforms: { android: a.wantsAndroid, ios: a.wantsIos },
          hasDownload: Boolean(downloadUrl),
          pageUrl: getAdminUrl(a.organization.slug, '/settings/mobile-app'),
        }),
      });
    }
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t mark it delivered');
  }
}

/**
 * Where it's listed, once Apple and Google approved it. Any listing makes it
 * live, and the store's website starts offering it (16.4).
 */
export async function recordAppListings(id: string, input: { appStoreId: string; onGooglePlay: boolean }): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const appStoreId = String(input.appStoreId ?? '').trim();
    if (appStoreId && !isAppStoreId(appStoreId)) return { success: false, error: 'The App Store id is the number in apps.apple.com/app/id…' };
    const a = await prisma.mobileApp.findUnique({ where: { id }, include: { organization: { select: { name: true, slug: true } } } });
    if (!a) return { success: false, error: 'App not found.' };
    if (a.stage !== 'DELIVERED' && a.stage !== 'LIVE') return { success: false, error: 'Deliver the app before recording its listings.' };

    const listed = Boolean(appStoreId) || input.onGooglePlay === true;
    const becomesLive = listed && a.stage !== 'LIVE';
    await prisma.mobileApp.update({
      where: { id },
      data: {
        appStoreId: appStoreId || null,
        onGooglePlay: input.onGooglePlay === true,
        handledById: staff.userId,
        ...(becomesLive ? { stage: 'LIVE' as const, liveAt: new Date() } : {}),
        ...(!listed && a.stage === 'LIVE' ? { stage: 'DELIVERED' as const, liveAt: null } : {}),
      },
    });
    await audit(a.organizationId, staff.userId, 'platform.mobile_app.listings', id, { appStoreId: appStoreId || null, onGooglePlay: input.onGooglePlay === true });
    if (becomesLive) {
      await sendPlatformNoticeEmail({
        to: await ownerEmails(a.organizationId),
        ...appLiveEmail({
          shopName: a.organization.name,
          appName: a.name,
          stores: [appStoreId ? 'the App Store' : null, input.onGooglePlay ? 'Google Play' : null].filter((s): s is string => Boolean(s)),
          pageUrl: getAdminUrl(a.organization.slug, '/settings/mobile-app'),
        }),
      });
    }
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t save the listings');
  }
}

/** By hand: switch the app off (it shows "no longer available") or back on. Renewing does the latter by itself. */
export async function setAppSwitchedOff(id: string, off: boolean, reason: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const why = String(reason ?? '').trim();
    if (off && why.length < 5) return { success: false, error: 'Say why, for the record.' };
    const a = await prisma.mobileApp.findUnique({ where: { id }, select: { organizationId: true, status: true } });
    if (!a) return { success: false, error: 'App not found.' };
    await prisma.mobileApp.update({
      where: { id },
      data: off ? { status: 'LAPSED' } : { status: 'ACTIVE', lapsedAt: null, graceEndsAt: null },
    });
    await audit(a.organizationId, staff.userId, off ? 'platform.mobile_app.switched_off' : 'platform.mobile_app.switched_on', id, why ? { reason: why } : undefined);
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t change that');
  }
}
