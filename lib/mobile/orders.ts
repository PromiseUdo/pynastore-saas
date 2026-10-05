/*
 * lib/mobile/orders.ts
 *
 * A store's own app as something a merchant orders and pays for
 * (ROADMAP 16.2). Server only.
 *
 *   REQUESTED  the merchant filled in Settings → Mobile app; not paid yet
 *   PAID       the setup fee arrived (the first year included): staff build it
 *   BUILDING   → DELIVERED (files handed over) → LIVE (a listing recorded)
 *
 * Paying runs through the platform's own Paystack billing, exactly like a
 * domain (lib/billing/checkout.ts): a BillingTransaction that changes no plan,
 * with a MobileAppPayment beside it. lib/billing/apply-charge.ts calls
 * applyMobileAppPayment once Paystack confirms it, from the callback or the
 * webhook, whichever is first — it is applied exactly once.
 *
 * The add-on is paid a year at a time; lib/mobile/renewals.ts reminds,
 * grants the grace days, and lapses an unpaid app.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { initializeTransaction } from '@/lib/billing/paystack';
import { getMobileAppPricing } from '@/lib/settings';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { isValidAppId, SHARED_APP_ID } from './app-config';
import { appPaidStaffEmail } from './emails';

export class MobileAppOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MobileAppOrderError';
  }
}

/* ── the request ───────────────────────────────────────────────────── */

export const APP_NAME_MAX = 30;
export const SHORT_DESCRIPTION_MAX = 80;
export const ICON_MIN_PX = 1024;

export interface MobileAppRequestInput {
  name: string;
  icon: { url: string; publicId: string; width?: number | null; height?: number | null } | null;
  backgroundColor: string;
  shortDescription: string;
  wantsAndroid: boolean;
  wantsIos: boolean;
}

export type RequestErrors = Partial<Record<'name' | 'icon' | 'backgroundColor' | 'shortDescription' | 'platforms', string>>;

/** What the merchant typed, checked. The icon's ownership is checked by the caller (isOrgAsset). */
export function checkMobileAppRequest(input: MobileAppRequestInput): RequestErrors {
  const errors: RequestErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = 'Give your app a name.';
  else if (name.length > APP_NAME_MAX) errors.name = `Keep it to ${APP_NAME_MAX} characters — the stores cut longer names off.`;

  if (!input.icon) errors.icon = 'Upload your app icon.';
  else if (input.icon.width && input.icon.height) {
    const { width, height } = input.icon;
    if (Math.min(width, height) < ICON_MIN_PX) errors.icon = `The icon needs to be at least ${ICON_MIN_PX} × ${ICON_MIN_PX} pixels.`;
    else if (Math.abs(width - height) > Math.max(width, height) * 0.02) errors.icon = 'The icon needs to be square.';
  }

  if (!/^#[0-9a-f]{6}$/i.test(input.backgroundColor.trim())) errors.backgroundColor = 'Choose a colour.';
  if (input.shortDescription.trim().length > SHORT_DESCRIPTION_MAX) {
    errors.shortDescription = `Keep it to ${SHORT_DESCRIPTION_MAX} characters.`;
  }
  if (!input.wantsAndroid && !input.wantsIos) errors.platforms = 'Choose Android, iPhone, or both.';
  return errors;
}

/**
 * A first suggestion for the app's id, from the store's handle:
 * `pyna-code` → `com.pynacode.shop`. Staff can change it until the app is
 * delivered; after that it is permanent.
 */
export function proposedAppId(slug: string, attempt = 0): string {
  let core = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!core) core = 'store';
  if (/^\d/.test(core)) core = `s${core}`;
  return `com.${core.slice(0, 40)}${attempt ? attempt + 1 : ''}.shop`;
}

async function unusedAppId(slug: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = proposedAppId(slug, attempt);
    if (id === SHARED_APP_ID || !isValidAppId(id)) continue;
    if (!(await prisma.mobileApp.findUnique({ where: { appId: id }, select: { id: true } }))) return id;
  }
  return `com.store${randomUUID().slice(0, 8).replace(/[^a-z0-9]/g, '')}.shop`;
}

/** Creates the store's request, or updates it while nothing is being built yet. */
export async function saveMobileAppRequest(input: {
  organizationId: string;
  slug: string;
  userId: string;
  request: MobileAppRequestInput;
}): Promise<{ id: string }> {
  const { request } = input;
  const details = {
    name: request.name.trim(),
    iconUrl: request.icon!.url,
    iconPublicId: request.icon!.publicId,
    backgroundColor: request.backgroundColor.trim().toLowerCase(),
    shortDescription: request.shortDescription.trim() || null,
    wantsAndroid: request.wantsAndroid,
    wantsIos: request.wantsIos,
  };

  const current = await prisma.mobileApp.findUnique({
    where: { organizationId: input.organizationId },
    select: { id: true, stage: true },
  });
  if (current) {
    if (current.stage !== 'REQUESTED' && current.stage !== 'PAID') {
      throw new MobileAppOrderError('Your app is already being built. Contact us to change it.');
    }
    await prisma.mobileApp.update({ where: { id: current.id }, data: details });
    return { id: current.id };
  }

  const created = await prisma.mobileApp.create({
    data: {
      organizationId: input.organizationId,
      appId: await unusedAppId(input.slug),
      requestedById: input.userId,
      stage: 'REQUESTED',
      ...details,
    },
    select: { id: true },
  });
  return created;
}

/* ── paying ─────────────────────────────────────────────────────────── */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** A year on from whichever is later: today, or the end of what's already paid. */
export function nextPaidThrough(current: Date | null, now: Date): Date {
  const from = current && current > now ? current : now;
  return new Date(from.getTime() + YEAR_MS);
}

/** When a renewal may be paid: once the app has been paid for, from 60 days before it runs out, or after. */
export function canRenew(app: { stage: string; paidThrough: Date | null }, now: Date): boolean {
  if (app.stage === 'REQUESTED' || !app.paidThrough) return false;
  return app.paidThrough.getTime() - now.getTime() <= 60 * 24 * 60 * 60 * 1000;
}

/**
 * Starts paying: the setup fee for a requested app, or a year's renewal.
 * Prices are read now, from Billing settings — never from the browser. Like a
 * domain, it needs a paid plan: not a trial, not a lapsed workspace.
 */
export async function startMobileAppCheckout(params: {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  userEmail: string;
  kind: 'SETUP' | 'RENEWAL';
  now?: Date;
}): Promise<{ authorizationUrl: string }> {
  const now = params.now ?? new Date();
  const [pricing, app, subscription] = await Promise.all([
    getMobileAppPricing(),
    prisma.mobileApp.findUnique({
      where: { organizationId: params.organizationId },
      select: { id: true, stage: true, paidThrough: true },
    }),
    prisma.subscription.findUnique({
      where: { organizationId: params.organizationId },
      select: { planId: true, billingCycle: true, status: true, plan: { select: { name: true } } },
    }),
  ]);

  const amount = params.kind === 'SETUP' ? pricing.setupFee : pricing.yearlyFee;
  if (amount === null) throw new MobileAppOrderError('Store apps aren’t on sale just now.');
  if (!subscription?.planId || (subscription.status !== 'ACTIVE' && subscription.status !== 'PAST_DUE')) {
    throw new MobileAppOrderError('A paid plan is needed for a store app. Choose a plan first.');
  }
  if (!app) throw new MobileAppOrderError('Tell us about your app first.');
  if (params.kind === 'SETUP' && app.stage !== 'REQUESTED') throw new MobileAppOrderError('Your app is already paid for.');
  if (params.kind === 'RENEWAL' && !canRenew(app, now)) throw new MobileAppOrderError('Your app doesn’t need renewing yet.');

  const reference = `mansaas_app_${params.organizationId}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const { authorizationUrl } = await initializeTransaction({
    email: params.userEmail,
    amountNaira: amount,
    reference,
    callbackUrl: `${appBaseUrl}/api/billing/paystack/callback`,
    metadata: {
      organizationId: params.organizationId,
      organizationSlug: params.organizationSlug,
      userId: params.userId,
      mobileApp: params.kind,
    },
  });

  await prisma.$transaction(async (tx) => {
    const transaction = await tx.billingTransaction.create({
      data: {
        organizationId: params.organizationId,
        reference,
        type: 'CHECKOUT',
        status: 'PENDING',
        // Recorded against the current plan, so its history reads correctly; the plan is not changed.
        planId: subscription.planId,
        planName: subscription.plan?.name ?? null,
        billingCycle: subscription.billingCycle,
        amount,
        currency: 'NGN',
        isPlanChange: false,
      },
      select: { id: true },
    });
    await tx.mobileAppPayment.create({
      data: { mobileAppId: app.id, billingTransactionId: transaction.id, kind: params.kind, amount },
    });
  });

  return { authorizationUrl };
}

/**
 * Paystack confirmed the charge (lib/billing/apply-charge.ts). Applied once:
 * the payment's `paidAt` is claimed with a conditional update.
 */
export async function applyMobileAppPayment(billingTransactionId: string, now = new Date()): Promise<void> {
  const payment = await prisma.mobileAppPayment.findUnique({
    where: { billingTransactionId },
    include: { mobileApp: { include: { organization: { select: { id: true, name: true, slug: true } } } } },
  });
  if (!payment || payment.paidAt) return;

  const app = payment.mobileApp;
  const paidThrough = nextPaidThrough(app.paidThrough, now);

  const applied = await prisma.$transaction(async (tx) => {
    const claimed = await tx.mobileAppPayment.updateMany({
      where: { id: payment.id, paidAt: null },
      data: { paidAt: now, coversUntil: paidThrough },
    });
    if (claimed.count !== 1) return false;
    await tx.mobileApp.update({
      where: { id: app.id },
      data: {
        paidThrough,
        // Paying ends any lapse: the app opens its store again.
        status: 'ACTIVE',
        lapsedAt: null,
        graceEndsAt: null,
        ...(payment.kind === 'SETUP' && app.stage === 'REQUESTED' ? { stage: 'PAID' as const, paidAt: now } : {}),
      },
    });
    return true;
  });
  if (!applied) return;

  await createAuditLog({
    organizationId: app.organizationId,
    userId: null,
    action: payment.kind === 'SETUP' ? 'settings.mobile_app.paid' : 'settings.mobile_app.renewed',
    entityType: 'MobileApp',
    entityId: app.id,
    metadata: { amount: Number(payment.amount), paidThrough: paidThrough.toISOString() },
  });

  // New work for staff: the setup fee means an app to build.
  if (payment.kind === 'SETUP' && process.env.PLATFORM_ADMIN_EMAIL) {
    await sendPlatformNoticeEmail({
      to: process.env.PLATFORM_ADMIN_EMAIL,
      ...appPaidStaffEmail({
        shopName: app.organization.name,
        appName: app.name,
        platforms: { android: app.wantsAndroid, ios: app.wantsIos },
        queueUrl: getMarketingUrl(`/platform/mobile-apps/${app.id}`),
      }),
    }).catch((error) => console.error('[mobile-app] Couldn’t tell staff about a paid app:', error));
  }
}
