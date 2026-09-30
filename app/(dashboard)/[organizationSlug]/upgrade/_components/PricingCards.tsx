'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format';
import { CYCLES, CYCLE_ORDER, FEATURE_INFO, LIMIT_INFO, type BillingCycleKey } from '@/lib/billing/plans';
import type { PlanOffer } from '@/lib/billing/catalogue';

type PricingCardsProps = {
  plans: PlanOffer[];
  current: { planId: string; cycle: string } | null;
  canManageBilling: boolean;
  onSelectPlan: (plan: PlanOffer, cycle: BillingCycleKey) => void;
};

export function PricingCards({ plans, current, canManageBilling, onSelectPlan }: PricingCardsProps) {
  // Only offer a cycle some plan is actually sold on.
  const cycles = CYCLE_ORDER.filter((c) => plans.some((p) => p.prices.some((price) => price.cycle === c)));
  const [cycle, setCycle] = React.useState<BillingCycleKey>(cycles[0] ?? 'MONTHLY');
  // The biggest saving on a cycle, to show on its tab ("Save up to 17%").
  const bestSaving = (c: BillingCycleKey) =>
    Math.max(0, ...plans.flatMap((p) => p.prices.filter((price) => price.cycle === c).map((price) => price.discountPct)));

  if (plans.length === 0) {
    return (
      <p className="rounded-md border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No plans are on sale right now. Please check back soon, or contact us.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <div role="tablist" aria-label="How often you pay" className="inline-flex flex-wrap items-center justify-center gap-1 rounded-lg border bg-muted/40 p-1">
        {cycles.map((c) => {
          const saving = bestSaving(c);
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                'flex min-h-8 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                cycle === c ? 'bg-background text-foreground shadow-xs ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {CYCLES[c].label}
              {saving > 0 && (
                <Badge variant="success" className="ml-0.5">
                  Save {saving}%
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {!canManageBilling && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Only the workspace owner, or someone they allow to manage billing, can choose a plan.
        </p>
      )}

      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const price = plan.prices.find((p) => p.cycle === cycle);
          const isCurrent = current?.planId === plan.id && current.cycle === cycle;
          const monthlyEquivalent = price && CYCLES[cycle].months > 1 ? price.amount / CYCLES[cycle].months : null;

          return (
            <div
              key={plan.id}
              className={cn('flex flex-col rounded-xl border bg-card p-5 shadow-xs', plan.highlighted && 'ring-2 ring-primary')}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
                {isCurrent ? (
                  <Badge variant="success">Current plan</Badge>
                ) : (
                  plan.highlighted && <Badge variant="default">Popular</Badge>
                )}
              </div>
              {plan.tagline && <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>}

              {price ? (
                <>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-2xl font-semibold tabular-nums text-foreground">{formatMoney(price.amount)}</span>
                    <span className="text-xs text-muted-foreground">/ {CYCLES[cycle].per}</span>
                  </div>
                  <p className="mt-0.5 min-h-4 text-xs text-muted-foreground tabular-nums">
                    {monthlyEquivalent !== null
                      ? `${formatMoney(Math.round(monthlyEquivalent))} a month${price.discountPct > 0 ? ` · save ${price.discountPct}%` : ''}`
                      : ''}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Not available {CYCLES[cycle].label.toLowerCase()}.</p>
              )}

              <Button
                className="mt-4 w-full"
                variant={plan.highlighted ? 'default' : 'outline'}
                disabled={!price || isCurrent || !canManageBilling}
                onClick={() => price && onSelectPlan(plan, cycle)}
              >
                {isCurrent ? 'Current plan' : `Choose ${plan.name}`}
              </Button>

              <ul className="mt-5 flex flex-col gap-2 text-xs">
                {(Object.keys(LIMIT_INFO) as (keyof typeof LIMIT_INFO)[]).map((key) => (
                  <li key={key} className="flex items-center gap-2 text-foreground">
                    <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    {LIMIT_INFO[key].label(plan.limits[key])}
                  </li>
                ))}
                {plan.features
                  .filter((f) => FEATURE_INFO[f].built)
                  .map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-foreground" title={FEATURE_INFO[feature].description}>
                      <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      {FEATURE_INFO[feature].label}
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
