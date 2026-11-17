/*
 * lib/marketing/offer.ts
 *
 * The facts the public site states about the offer (ROADMAP 12.3), read from
 * the same places the app uses — the plan catalogue (12.1/11.7) and the
 * billing settings — so the marketing pages can never promise a trial or a
 * price the product doesn't give. Falls back to wording without numbers if
 * the database can't be read (e.g. while building without one).
 */
import { listPlansForSale } from '@/lib/billing/catalogue';
import { FEATURES } from '@/lib/billing/plans';
import { comNgOnSale, getBillingSettings, getComNgPricing, getMobileAppPricing } from '@/lib/settings';

export interface PublicOffer {
  /** 0 = no trial */
  trialDays: number;
  trialPlanName: string | null;
  /** the cheapest monthly price on sale, NGN */
  fromMonthly: number | null;
  graceDays: number | null;
  /** A store's own phone app (ROADMAP 16), an add-on: NGN, both null when it isn't on sale */
  appSetupFee: number | null;
  appYearlyFee: number | null;
  /** .com.ng can be bought through us (22.3) */
  comNg: boolean;
  /** the plans whose yearly billing includes a free .com.ng, cheapest first — empty when none */
  freeDomainPlans: string[];
}

/** "Growth", "Growth or Business", "Growth, Business or Pro" */
export function orList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export async function getPublicOffer(): Promise<PublicOffer> {
  try {
    const [plans, settings, app, comNg] = await Promise.all([
      listPlansForSale(),
      getBillingSettings(),
      getMobileAppPricing().catch(() => ({ setupFee: null, yearlyFee: null })),
      getComNgPricing().catch(() => ({ registerPrice: null, renewPrice: null })),
    ]);
    const monthly = plans.flatMap((p) => p.prices.filter((x) => x.cycle === 'MONTHLY').map((x) => x.amount));
    const trialPlan = plans.find((p) => p.key === settings.trialPlanKey) ?? null;
    return {
      trialDays: trialPlan ? settings.trialDays : 0,
      trialPlanName: trialPlan?.name ?? null,
      fromMonthly: monthly.length ? Math.min(...monthly) : null,
      graceDays: settings.graceDays,
      // On sale only when both fees are set — the same rule as Settings → Mobile app.
      appSetupFee: app.setupFee !== null && app.yearlyFee !== null ? app.setupFee : null,
      appYearlyFee: app.setupFee !== null && app.yearlyFee !== null ? app.yearlyFee : null,
      comNg: comNgOnSale(comNg),
      // listPlansForSale already drops the free domain while .com.ng is off sale.
      freeDomainPlans: plans.filter((p) => p.features.includes(FEATURES.FREE_DOMAIN)).map((p) => p.name),
    };
  } catch {
    return {
      trialDays: 0,
      trialPlanName: null,
      fromMonthly: null,
      graceDays: null,
      appSetupFee: null,
      appYearlyFee: null,
      comNg: false,
      freeDomainPlans: [],
    };
  }
}
