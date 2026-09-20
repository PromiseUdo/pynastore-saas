'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getYearlyPrice, type PlanConfig, type FeatureKey } from '@/lib/billing/plans';
import { formatNaira } from '@/lib/billing/format';
import type { OrganizationPlan, BillingCycle } from '@/lib/generated/prisma/enums';

const FEATURE_LABELS: Record<FeatureKey, string> = {
  'procurement.module': 'Procurement module',
  'inventory.module': 'Inventory module',
  'inventory.multi_warehouse': 'Multi-warehouse inventory',
  'inventory.kits': 'Kits & assemblies (BOM)',
  'procurement.auto_reorder': 'Automatic PO reorder drafts',
  'sales.module': 'Sales module',
  'roles.custom': 'Custom roles & permissions',
  'reports.advanced': 'Advanced reports',
  'audit_log.export': 'Audit log export',
  'api.access': 'API access',
};

const LIMIT_LABELS = (limits: PlanConfig['limits']): string[] => [
  limits.maxSeats === null ? 'Unlimited seats' : `${limits.maxSeats} team seats`,
  limits.maxWarehouses === null ? 'Unlimited warehouses' : `${limits.maxWarehouses} warehouse${limits.maxWarehouses === 1 ? '' : 's'}`,
  limits.maxProjects === null ? 'Unlimited projects' : `${limits.maxProjects} projects`,
];

type PricingCardsProps = {
  plans: PlanConfig[];
  currentPlan: OrganizationPlan;
  canManageBilling: boolean;
  /** Advances the wizard to Domain Setup for a paid plan (FREE has nothing to check out). */
  onSelectPlan: (plan: 'STARTER' | 'PRO' | 'ENTERPRISE', billingCycle: BillingCycle) => void;
};

export function PricingCards({ plans, currentPlan, canManageBilling, onSelectPlan }: PricingCardsProps) {
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>('MONTHLY');
  const [error, setError] = React.useState<string | null>(null);

  function handleChoose(plan: OrganizationPlan) {
    if (!canManageBilling) {
      setError('Only your workspace Owner or Admin can change billing plans.');
      return;
    }
    if (plan === 'FREE') return;
    setError(null);
    onSelectPlan(plan, billingCycle);
  }

  return (
    <div className="flex flex-col items-center gap-8">
      {/* Billing cycle toggle */}
      <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
        {(['MONTHLY', 'YEARLY'] as const).map((cycle) => (
          <button
            key={cycle}
            onClick={() => setBillingCycle(cycle)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              billingCycle === cycle
                ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'}
            {cycle === 'YEARLY' && (
              <Badge variant="success" className="ml-0.5">
                Save ~17%
              </Badge>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {/* Plan cards */}
      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const price = billingCycle === 'YEARLY' ? getYearlyPrice(plan.monthlyPrice) : plan.monthlyPrice;
          const isCurrent = plan.key === currentPlan;
          const isFree = plan.key === 'FREE';

          return (
            <div
              key={plan.key}
              className={cn(
                'flex flex-col rounded-xl border bg-card p-5 shadow-xs',
                plan.highlighted && 'ring-2 ring-primary',
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
                {plan.highlighted && <Badge variant="default">Popular</Badge>}
                {isCurrent && <Badge variant="success">Current plan</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatNaira(price)}
                </span>
                {!isFree && (
                  <span className="text-xs text-muted-foreground">
                    /{billingCycle === 'YEARLY' ? 'year' : 'month'}
                  </span>
                )}
              </div>

              <Button
                className="mt-4 w-full"
                variant={plan.highlighted ? 'default' : 'outline'}
                disabled={isCurrent || isFree}
                onClick={() => handleChoose(plan.key)}
              >
                {isCurrent ? 'Current plan' : isFree ? 'Included free' : `Upgrade to ${plan.name}`}
              </Button>

              <ul className="mt-5 flex flex-col gap-2 text-xs">
                {LIMIT_LABELS(plan.limits).map((label) => (
                  <li key={label} className="flex items-center gap-2 text-foreground">
                    <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    {label}
                  </li>
                ))}
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-foreground">
                    <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    {FEATURE_LABELS[feature]}
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
