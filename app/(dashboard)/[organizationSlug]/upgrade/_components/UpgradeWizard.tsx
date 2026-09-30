'use client';

import * as React from 'react';
import { PricingCards } from './PricingCards';
import { CheckoutSummaryStep } from './CheckoutSummaryStep';
import type { PlanOffer } from '@/lib/billing/catalogue';
import type { BillingCycleKey } from '@/lib/billing/plans';

type UpgradeWizardProps = {
  plans: PlanOffer[];
  /** the plan and cycle being paid for now, if any */
  current: { planId: string; cycle: string } | null;
  canManageBilling: boolean;
};

/**
 * Choose a plan, then pay. A custom domain is no longer a step here — it has
 * its own page, Settings → Domain (ROADMAP 12.6).
 */
export function UpgradeWizard({ plans, current, canManageBilling }: UpgradeWizardProps) {
  const [selected, setSelected] = React.useState<{ plan: PlanOffer; cycle: BillingCycleKey } | null>(null);

  if (!selected) {
    return (
      <PricingCards
        plans={plans}
        current={current}
        canManageBilling={canManageBilling}
        onSelectPlan={(plan, cycle) => setSelected({ plan, cycle })}
      />
    );
  }

  const price = selected.plan.prices.find((p) => p.cycle === selected.cycle);
  if (!price) return null;
  return (
    <CheckoutSummaryStep
      plan={{ id: selected.plan.id, name: selected.plan.name, cycle: selected.cycle, amount: price.amount }}
      onBack={() => setSelected(null)}
    />
  );
}
