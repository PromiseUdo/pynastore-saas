'use client';

import * as React from 'react';
import { PricingCards } from './PricingCards';
import { DomainSetupStep, type DomainSummary } from './DomainSetupStep';
import { CheckoutSummaryStep } from './CheckoutSummaryStep';
import type { PlanConfig } from '@/lib/billing/plans';
import type { OrganizationPlan, BillingCycle } from '@/lib/generated/prisma/enums';
import type { DomainChoiceInput } from '@/lib/billing/checkout';

type Step = 'plan' | 'domain' | 'checkout';
type PaidPlan = 'STARTER' | 'PRO' | 'ENTERPRISE';

type UpgradeWizardProps = {
  plans: PlanConfig[];
  currentPlan: OrganizationPlan;
  canManageBilling: boolean;
  orgSlug: string;
  rootDomain: string;
};

export function UpgradeWizard({
  plans,
  currentPlan,
  canManageBilling,
  orgSlug,
  rootDomain,
}: UpgradeWizardProps) {
  const [step, setStep] = React.useState<Step>('plan');
  const [selectedPlan, setSelectedPlan] = React.useState<PaidPlan | null>(null);
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>('MONTHLY');
  const [domainChoice, setDomainChoice] = React.useState<DomainChoiceInput | null>(null);
  const [domainSummary, setDomainSummary] = React.useState<DomainSummary | null>(null);

  if (step === 'plan') {
    return (
      <PricingCards
        plans={plans}
        currentPlan={currentPlan}
        canManageBilling={canManageBilling}
        onSelectPlan={(plan, cycle) => {
          setSelectedPlan(plan);
          setBillingCycle(cycle);
          setStep('domain');
        }}
      />
    );
  }

  if (step === 'domain' && selectedPlan) {
    return (
      <DomainSetupStep
        orgSlug={orgSlug}
        rootDomain={rootDomain}
        onBack={() => setStep('plan')}
        onContinue={(choice, summary) => {
          setDomainChoice(choice);
          setDomainSummary(summary);
          setStep('checkout');
        }}
      />
    );
  }

  if (step === 'checkout' && selectedPlan && domainChoice && domainSummary) {
    return (
      <CheckoutSummaryStep
        plan={selectedPlan}
        billingCycle={billingCycle}
        domainChoice={domainChoice}
        domainLabel={domainSummary.label}
        domainPriceNgn={domainSummary.priceNgn}
        onBack={() => setStep('domain')}
      />
    );
  }

  return null;
}
