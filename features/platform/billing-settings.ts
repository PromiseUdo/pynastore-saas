'use server';

/*
 * features/platform/billing-settings.ts
 *
 * The platform-wide billing settings, edited in the console (ROADMAP 11.7):
 * the free trial (length, and which plan it gives), the grace period, and the
 * dollar-to-naira rate used to price domain registrations. Platform staff
 * only. Saved together, with one audit entry naming what changed.
 *
 * - The trial applies to workspaces created after the change; a running trial
 *   keeps its end date. 0 days means no trial: new workspaces go straight to
 *   choosing a plan.
 * - The grace period applies to subscriptions that lapse after the change —
 *   each lapse fixes its own deadline when it's recorded (12.1).
 * - A store's own app (ROADMAP 16.2): the setup fee (the first year
 *   included), the yearly fee, and the app's own grace days. A blank fee
 *   takes the add-on off sale; what merchants already paid is unchanged.
 */
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { writePlatformAudit } from '@/lib/platform-audit';
import { getBillingSettings, getMobileAppPricing, getUsdToNgnRate, MOBILE_APP_SETTING_KEYS } from '@/lib/settings';

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Partial<Record<keyof BillingSettingsInput, string>> };

export interface BillingSettingsInput {
  trialDays: number;
  /** the plan's id — stored as its key */
  trialPlanId: string;
  graceDays: number;
  usdToNgnRate: number;
  /** NGN; null = the add-on isn't on sale */
  mobileAppSetupFee: number | null;
  mobileAppYearlyFee: number | null;
  mobileAppGraceDays: number;
}

export interface ConsoleBillingSettings extends BillingSettingsInput {
  /** plans on sale — the ones a trial may give */
  plans: { id: string; name: string }[];
  /** the saved trial plan key matches no plan on sale (it was retired or renamed in the database) */
  trialPlanMissing: boolean;
}

const KEYS = {
  trialDays: 'trial_days',
  trialPlanKey: 'trial_plan_key',
  graceDays: 'grace_days',
  usdToNgnRate: 'usd_to_ngn_rate',
  ...MOBILE_APP_SETTING_KEYS,
};

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') {
    return { success: false, error: 'Only platform staff can do this' };
  }
  console.error(`[platform/billing-settings] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function getConsoleBillingSettings(): Promise<ActionResult<ConsoleBillingSettings>> {
  try {
    await requirePlatformStaff();
    const [settings, rate, app, plans] = await Promise.all([
      getBillingSettings(),
      getUsdToNgnRate(),
      getMobileAppPricing(),
      prisma.billingPlan.findMany({
        where: { isOnSale: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, key: true, name: true },
      }),
    ]);
    const trialPlan = plans.find((p) => p.key === settings.trialPlanKey);
    return {
      success: true,
      data: {
        trialDays: settings.trialDays,
        trialPlanId: trialPlan?.id ?? '',
        graceDays: settings.graceDays,
        usdToNgnRate: rate,
        mobileAppSetupFee: app.setupFee,
        mobileAppYearlyFee: app.yearlyFee,
        mobileAppGraceDays: app.graceDays,
        plans: plans.map((p) => ({ id: p.id, name: p.name })),
        trialPlanMissing: !trialPlan,
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the billing settings');
  }
}

const wholeDays = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 365;

export async function updateBillingSettings(input: BillingSettingsInput): Promise<ActionResult<{ changed: string[] }>> {
  try {
    const staff = await requirePlatformStaff();

    const fieldErrors: Partial<Record<keyof BillingSettingsInput, string>> = {};
    if (!wholeDays(input.trialDays)) fieldErrors.trialDays = 'Enter a whole number of days from 0 to 365.';
    if (!wholeDays(input.graceDays)) fieldErrors.graceDays = 'Enter a whole number of days from 0 to 365.';
    if (typeof input.usdToNgnRate !== 'number' || !Number.isFinite(input.usdToNgnRate) || input.usdToNgnRate <= 0 || input.usdToNgnRate > 100_000) {
      fieldErrors.usdToNgnRate = 'Enter how many naira one US dollar costs.';
    }
    const plan = input.trialPlanId
      ? await prisma.billingPlan.findFirst({ where: { id: input.trialPlanId, isOnSale: true }, select: { key: true, name: true } })
      : null;
    if (!plan && input.trialDays > 0) fieldErrors.trialPlanId = 'Choose a plan that’s on sale.';
    const fee = (n: unknown) => n === null || (typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100_000_000);
    if (!fee(input.mobileAppSetupFee)) fieldErrors.mobileAppSetupFee = 'Enter an amount in naira, or leave it empty.';
    if (!fee(input.mobileAppYearlyFee)) fieldErrors.mobileAppYearlyFee = 'Enter an amount in naira, or leave it empty.';
    if ((input.mobileAppSetupFee === null) !== (input.mobileAppYearlyFee === null)) {
      fieldErrors.mobileAppYearlyFee = 'Set both fees to sell the add-on, or leave both empty.';
    }
    if (!wholeDays(input.mobileAppGraceDays)) fieldErrors.mobileAppGraceDays = 'Enter a whole number of days from 0 to 365.';
    if (Object.keys(fieldErrors).length) return { success: false, error: 'Check the highlighted fields.', fieldErrors };

    const [current, rate, app] = await Promise.all([getBillingSettings(), getUsdToNgnRate(), getMobileAppPricing()]);
    const before = {
      trialDays: current.trialDays,
      trialPlanKey: current.trialPlanKey,
      graceDays: current.graceDays,
      usdToNgnRate: rate,
      mobileAppSetupFee: app.setupFee,
      mobileAppYearlyFee: app.yearlyFee,
      mobileAppGraceDays: app.graceDays,
    };
    const naira = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
    const after = {
      trialDays: input.trialDays,
      // With no trial, the plan setting is left as it was.
      trialPlanKey: plan?.key ?? current.trialPlanKey,
      graceDays: input.graceDays,
      usdToNgnRate: Math.round(input.usdToNgnRate * 100) / 100,
      mobileAppSetupFee: naira(input.mobileAppSetupFee),
      mobileAppYearlyFee: naira(input.mobileAppYearlyFee),
      mobileAppGraceDays: input.mobileAppGraceDays,
    };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
    if (!changed.length) return { success: true, data: { changed: [] } };

    await prisma.$transaction(async (tx) => {
      for (const key of changed) {
        // An emptied fee takes the add-on off sale.
        if (after[key] === null) {
          await tx.platformSetting.deleteMany({ where: { key: KEYS[key] } });
          continue;
        }
        await tx.platformSetting.upsert({
          where: { key: KEYS[key] },
          create: { key: KEYS[key], value: String(after[key]) },
          update: { value: String(after[key]) },
        });
      }
      await writePlatformAudit(tx, {
        userId: staff.userId,
        action: 'platform.settings.updated',
        entityType: 'PlatformSetting',
        entityId: 'billing',
        metadata: {
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        },
      });
    }, { timeout: 20_000, maxWait: 10_000 });

    return { success: true, data: { changed } };
  } catch (error) {
    return denied(error, 'We couldn’t save the billing settings');
  }
}
