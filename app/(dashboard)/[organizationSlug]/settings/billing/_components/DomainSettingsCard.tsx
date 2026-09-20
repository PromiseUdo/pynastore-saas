'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DomainSetupStep, type DomainSummary } from '../../../upgrade/_components/DomainSetupStep';
import { CheckoutSummaryStep } from '../../../upgrade/_components/CheckoutSummaryStep';
import type { DomainChoiceInput } from '@/lib/billing/checkout';

type DomainSettingsCardProps = {
  orgSlug: string;
  rootDomain: string;
  canManageBilling: boolean;
  isPaidPlan: boolean;
  customAdminDomain: string | null;
  customStoreDomain: string | null;
  pendingDomainOrder: { type: 'EXISTING' | 'REGISTER'; domain: string | null } | null;
};

export function DomainSettingsCard({
  orgSlug,
  rootDomain,
  canManageBilling,
  isPaidPlan,
  customAdminDomain,
  customStoreDomain,
  pendingDomainOrder,
}: DomainSettingsCardProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [domainChoice, setDomainChoice] = React.useState<DomainChoiceInput | null>(null);
  const [domainSummary, setDomainSummary] = React.useState<DomainSummary | null>(null);

  if (!isPaidPlan) return null;

  return (
    <div className="rounded-lg border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Custom domain</h2>
          {customAdminDomain ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <Badge variant="success" className="mr-2">
                Active
              </Badge>
              {customAdminDomain}
              {customStoreDomain && <> · {customStoreDomain}</>}
            </p>
          ) : pendingDomainOrder ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <Badge variant="warning" className="mr-2">
                Pending
              </Badge>
              {pendingDomainOrder.domain} — active within 24 hours
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a domain you own, or register a new one.
            </p>
          )}
        </div>

        {canManageBilling && !customAdminDomain && !pendingDomainOrder && !open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Set up custom domain
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-5 border-t pt-5">
          {!domainChoice ? (
            <DomainSetupStep
              orgSlug={orgSlug}
              rootDomain={rootDomain}
              showFreeOption={false}
              onBack={() => setOpen(false)}
              onContinue={(choice, summary) => {
                setDomainChoice(choice);
                setDomainSummary(summary);
              }}
            />
          ) : (
            domainSummary && (
              <CheckoutSummaryStep
                domainChoice={domainChoice}
                domainLabel={domainSummary.label}
                domainPriceNgn={domainSummary.priceNgn}
                onBack={() => setDomainChoice(null)}
                onSubmittedWithoutPayment={() => {
                  setOpen(false);
                  setDomainChoice(null);
                  setDomainSummary(null);
                  router.refresh();
                }}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
