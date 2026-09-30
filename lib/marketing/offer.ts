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
import { getBillingSettings } from '@/lib/settings';

export interface PublicOffer {
  /** 0 = no trial */
  trialDays: number;
  trialPlanName: string | null;
  /** the cheapest monthly price on sale, NGN */
  fromMonthly: number | null;
  graceDays: number | null;
}

export async function getPublicOffer(): Promise<PublicOffer> {
  try {
    const [plans, settings] = await Promise.all([listPlansForSale(), getBillingSettings()]);
    const monthly = plans.flatMap((p) => p.prices.filter((x) => x.cycle === 'MONTHLY').map((x) => x.amount));
    const trialPlan = plans.find((p) => p.key === settings.trialPlanKey) ?? null;
    return {
      trialDays: trialPlan ? settings.trialDays : 0,
      trialPlanName: trialPlan?.name ?? null,
      fromMonthly: monthly.length ? Math.min(...monthly) : null,
      graceDays: settings.graceDays,
    };
  } catch {
    return { trialDays: 0, trialPlanName: null, fromMonthly: null, graceDays: null };
  }
}
