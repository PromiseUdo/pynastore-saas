'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { CYCLES, type BillingCycleKey } from '@/lib/billing/plans';
import { createCheckoutSession } from '@/features/billing/actions';

type CheckoutSummaryStepProps = {
  plan: { id: string; name: string; cycle: BillingCycleKey; amount: number };
  onBack: () => void;
};

/** What the merchant is about to pay for, then off to Paystack. The server prices it again. */
export function CheckoutSummaryStep({ plan, onBack }: CheckoutSummaryStepProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handlePay() {
    setError(null);
    startTransition(async () => {
      const result = await createCheckoutSession({ planId: plan.id, billingCycle: plan.cycle });
      if (!result.success) {
        setError(result.error);
        return;
      }
      window.location.href = result.data.authorizationUrl;
    });
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Checkout summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">Review your plan before paying.</p>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground">
            {plan.name} plan ({CYCLES[plan.cycle].label.toLowerCase()})
          </span>
          <span className="font-medium tabular-nums text-foreground">{formatMoney(plan.amount)}</span>
        </div>
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="text-sm font-semibold text-foreground">Total due today</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">{formatMoney(plan.amount)}</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Renews {CYCLES[plan.cycle].label.toLowerCase()} at the same price until you change plan or cancel.
        </p>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          Back
        </Button>
        <Button onClick={handlePay} disabled={isPending}>
          {isPending && <Loader2 className="size-3.5 animate-spin" />}
          Pay with Paystack
        </Button>
      </div>
    </div>
  );
}
