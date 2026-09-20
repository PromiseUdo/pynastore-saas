'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNaira } from '@/lib/billing/format';
import { getYearlyPrice, PLANS } from '@/lib/billing/plans';
import { createCheckoutSession } from '@/features/billing/actions';
import { purchaseDomain } from '@/features/domains/actions';
import type { BillingCycle } from '@/lib/generated/prisma/enums';
import type { DomainChoiceInput } from '@/lib/billing/checkout';

type CheckoutSummaryStepProps = {
  /** Omitted for a domain-only purchase (Settings -> Billing, plan unchanged). */
  plan?: 'STARTER' | 'PRO' | 'ENTERPRISE';
  billingCycle?: BillingCycle;
  domainChoice: DomainChoiceInput;
  domainLabel: string;
  domainPriceNgn: number;
  onBack: () => void;
  /** Called instead of redirecting when there was nothing to charge (e.g. connecting a domain you already own, standalone). */
  onSubmittedWithoutPayment?: () => void;
};

export function CheckoutSummaryStep({
  plan,
  billingCycle,
  domainChoice,
  domainLabel,
  domainPriceNgn,
  onBack,
  onSubmittedWithoutPayment,
}: CheckoutSummaryStepProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const planPrice =
    plan && billingCycle
      ? billingCycle === 'YEARLY'
        ? getYearlyPrice(PLANS[plan].monthlyPrice)
        : PLANS[plan].monthlyPrice
      : 0;
  const total = planPrice + domainPriceNgn;

  function handlePay() {
    setError(null);
    startTransition(async () => {
      const result =
        plan && billingCycle
          ? await createCheckoutSession({ plan, billingCycle, domainChoice })
          : await purchaseDomain(domainChoice as Extract<DomainChoiceInput, { type: 'EXISTING' | 'REGISTER' }>);
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (result.data.authorizationUrl) {
        window.location.href = result.data.authorizationUrl;
      } else {
        onSubmittedWithoutPayment?.();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Checkout summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">Review your order before paying.</p>
      </div>

      <div className="rounded-lg border bg-card p-5">
        {plan && billingCycle && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">
              {PLANS[plan].name} plan ({billingCycle === 'YEARLY' ? 'yearly' : 'monthly'})
            </span>
            <span className="font-medium tabular-nums text-foreground">{formatNaira(planPrice)}</span>
          </div>
        )}

        {domainChoice.type !== 'FREE' && (
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-foreground">{domainLabel}</span>
            {domainPriceNgn > 0 ? (
              <span className="font-medium tabular-nums text-foreground">{formatNaira(domainPriceNgn)}</span>
            ) : (
              <span className="text-xs text-muted-foreground">No additional cost</span>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="text-sm font-semibold text-foreground">Total due today</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">{formatNaira(total)}</span>
        </div>
      </div>

      {domainChoice.type === 'REGISTER' && (
        <p className="text-xs text-muted-foreground">
          Your domain will be active within 24 hours after payment.
        </p>
      )}
      {domainChoice.type === 'EXISTING' && (
        <p className="text-xs text-muted-foreground">
          We&apos;ll follow up with DNS instructions after payment — your domain will be active
          within 24 hours.
        </p>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          Back
        </Button>
        <Button onClick={handlePay} disabled={isPending}>
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : total > 0 ? (
            'Pay with Paystack'
          ) : (
            'Confirm'
          )}
        </Button>
      </div>
    </div>
  );
}
