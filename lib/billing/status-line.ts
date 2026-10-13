/*
 * lib/billing/status-line.ts
 *
 * The plan's state in words, for Settings → Billing and the business app's
 * read-only plan page (ROADMAP 12.1, 19.3). One place, so both say the same.
 *
 * `noBuying` (the business app): facts only — no prices, and nothing that
 * points to choosing or paying for a plan (App Review 3.1.3(f)).
 */
import { formatDate, formatMoney } from '@/lib/format';
import { CYCLES, type BillingCycleKey } from './plans';
import type { AccessState } from './access';

/** What the workspace's plan means right now, as a badge (ROADMAP 12.1). */
export const ACCESS_BADGE: Record<AccessState, { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' | 'muted' }> = {
  active: { label: 'Active', variant: 'success' },
  trial: { label: 'Free trial', variant: 'info' },
  grace: { label: 'Ended — shop still open', variant: 'warning' },
  lapsed: { label: 'Ended — shop closed', variant: 'destructive' },
  none: { label: 'No plan', variant: 'muted' },
};

export const cycleLabel = (cycle: string | null | undefined) =>
  cycle && Object.hasOwn(CYCLES, cycle) ? CYCLES[cycle as BillingCycleKey].label.toLowerCase() : null;

export interface PlanStatusInput {
  access: { state: AccessState; trialEndsAt: Date | null; graceEndsAt: Date | null };
  subscription: { currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; amount: number | null; billingCycle: string } | null;
  noBuying?: boolean;
}

export function planStatusLine({ access, subscription, noBuying = false }: PlanStatusInput): string | null {
  switch (access.state) {
    case 'trial':
      if (!access.trialEndsAt) return null;
      return noBuying
        ? `Your free trial ends on ${formatDate(access.trialEndsAt)}.`
        : `Your free trial ends on ${formatDate(access.trialEndsAt)}. Nothing is charged unless you choose a plan.`;
    case 'grace':
      return access.graceEndsAt ? `Your plan has ended. Your shop keeps taking orders until ${formatDate(access.graceEndsAt)}.` : null;
    case 'lapsed':
      return noBuying
        ? 'Your plan has ended and your shop is closed to customers.'
        : 'Your plan has ended and your shop is closed to customers. Choosing a plan reopens it straight away.';
    case 'none':
      return noBuying ? 'This shop has no plan.' : 'Choose a plan to get started.';
    case 'active': {
      if (!subscription?.currentPeriodEnd) return null;
      const when = `${subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on ${formatDate(subscription.currentPeriodEnd)}`;
      const cycle = cycleLabel(subscription.billingCycle);
      const price = !noBuying && subscription.amount !== null && cycle ? ` · ${formatMoney(subscription.amount)}, billed ${cycle}` : '';
      return `${when}${price}`;
    }
  }
}
