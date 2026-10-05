/*
 * lib/settings.ts
 *
 * Platform-wide, admin-tunable settings backed by PlatformSetting
 * (key-value): the USD->NGN rate used to price domain registrations, and the
 * trial and grace-period lengths (ROADMAP 12.1, further down).
 *
 * The rate is deliberately NOT a live FX API: platform staff set and update
 * it, consistent with domain fulfillment itself being a manual process.
 * All of these are edited in the platform console → Billing settings
 * (features/platform/billing-settings.ts, ROADMAP 11.7), which also writes
 * the audit entry. Change them there, not in the database.
 */
import { prisma } from '@/lib/prisma';

const USD_TO_NGN_RATE_KEY = 'usd_to_ngn_rate';

/** Only used if no rate has ever been set — logs loudly so it isn't silently relied on. */
const FALLBACK_USD_TO_NGN_RATE = 1600;

export async function getUsdToNgnRate(): Promise<number> {
  const setting = await prisma.platformSetting.findUnique({
    where: { key: USD_TO_NGN_RATE_KEY },
  });

  if (!setting) {
    console.warn(
      `[settings] No "${USD_TO_NGN_RATE_KEY}" PlatformSetting row exists — using fallback rate ${FALLBACK_USD_TO_NGN_RATE}. Set one via setUsdToNgnRate() or directly in the database.`,
    );
    return FALLBACK_USD_TO_NGN_RATE;
  }

  const rate = Number(setting.value);
  if (!Number.isFinite(rate) || rate <= 0) {
    console.warn(
      `[settings] "${USD_TO_NGN_RATE_KEY}" PlatformSetting value "${setting.value}" is not a valid positive number — using fallback rate ${FALLBACK_USD_TO_NGN_RATE}.`,
    );
    return FALLBACK_USD_TO_NGN_RATE;
  }

  return rate;
}

export async function setUsdToNgnRate(rate: number): Promise<void> {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange rate must be a positive number.');
  }
  await prisma.platformSetting.upsert({
    where: { key: USD_TO_NGN_RATE_KEY },
    create: { key: USD_TO_NGN_RATE_KEY, value: String(rate) },
    update: { value: String(rate) },
  });
}

/* ---------------- billing: the trial and the grace period (ROADMAP 12.1) ---------------- */

/*
 * Set by platform staff in the console (11.7). The defaults are the starting points: a 14-day
 * trial of Pro, and 10 days' grace after a plan lapses (0 is allowed: the
 * storefront then closes the moment it lapses).
 */
const TRIAL_DAYS_KEY = 'trial_days';
const TRIAL_PLAN_KEY = 'trial_plan_key';
const GRACE_DAYS_KEY = 'grace_days';

export const DEFAULT_BILLING_SETTINGS = { trialDays: 14, trialPlanKey: 'pro', graceDays: 10 } as const;

export interface BillingSettings {
  trialDays: number;
  trialPlanKey: string;
  graceDays: number;
}

function wholeDays(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : fallback;
}

export async function getBillingSettings(): Promise<BillingSettings> {
  const rows = await prisma.platformSetting.findMany({
    where: { key: { in: [TRIAL_DAYS_KEY, TRIAL_PLAN_KEY, GRACE_DAYS_KEY] } },
  });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return {
    trialDays: wholeDays(value(TRIAL_DAYS_KEY), DEFAULT_BILLING_SETTINGS.trialDays),
    trialPlanKey: value(TRIAL_PLAN_KEY)?.trim() || DEFAULT_BILLING_SETTINGS.trialPlanKey,
    graceDays: wholeDays(value(GRACE_DAYS_KEY), DEFAULT_BILLING_SETTINGS.graceDays),
  };
}

export async function setBillingSetting(key: 'trialDays' | 'trialPlanKey' | 'graceDays', value: number | string): Promise<void> {
  const stored = { trialDays: TRIAL_DAYS_KEY, trialPlanKey: TRIAL_PLAN_KEY, graceDays: GRACE_DAYS_KEY }[key];
  if (key !== 'trialPlanKey' && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 365)) {
    throw new Error('Days must be a whole number from 0 to 365.');
  }
  await prisma.platformSetting.upsert({
    where: { key: stored },
    create: { key: stored, value: String(value) },
    update: { value: String(value) },
  });
}

/* ---------------- a store's own phone app (ROADMAP 16.2) ---------------- */

/*
 * Set by platform staff in Billing settings. A fee left unset means the
 * add-on isn't on sale: merchants see that it's coming, and nothing can be
 * paid. The setup fee includes the first year; each later year is the
 * yearly fee. After a year runs out, the app keeps working for the grace
 * days, then shows "no longer available" until it's renewed.
 */
const MOBILE_APP_SETUP_FEE_KEY = 'mobile_app_setup_fee';
const MOBILE_APP_YEARLY_FEE_KEY = 'mobile_app_yearly_fee';
const MOBILE_APP_GRACE_DAYS_KEY = 'mobile_app_grace_days';

export const DEFAULT_MOBILE_APP_GRACE_DAYS = 14;

export interface MobileAppPricing {
  /** NGN, or null when not on sale */
  setupFee: number | null;
  yearlyFee: number | null;
  graceDays: number;
}

function naira(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getMobileAppPricing(): Promise<MobileAppPricing> {
  const rows = await prisma.platformSetting.findMany({
    where: { key: { in: [MOBILE_APP_SETUP_FEE_KEY, MOBILE_APP_YEARLY_FEE_KEY, MOBILE_APP_GRACE_DAYS_KEY] } },
  });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return {
    setupFee: naira(value(MOBILE_APP_SETUP_FEE_KEY)),
    yearlyFee: naira(value(MOBILE_APP_YEARLY_FEE_KEY)),
    graceDays: wholeDays(value(MOBILE_APP_GRACE_DAYS_KEY), DEFAULT_MOBILE_APP_GRACE_DAYS),
  };
}

export const MOBILE_APP_SETTING_KEYS = {
  mobileAppSetupFee: MOBILE_APP_SETUP_FEE_KEY,
  mobileAppYearlyFee: MOBILE_APP_YEARLY_FEE_KEY,
  mobileAppGraceDays: MOBILE_APP_GRACE_DAYS_KEY,
} as const;
