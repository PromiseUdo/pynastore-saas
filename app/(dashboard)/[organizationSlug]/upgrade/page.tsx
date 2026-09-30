import type { Metadata } from 'next';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { getOrganizationContext } from '@/lib/organization';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { listPlansForSale } from '@/lib/billing/catalogue';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { UpgradeWizard } from './_components/UpgradeWizard';

export const metadata: Metadata = { title: 'Plans' };

export default async function UpgradePage() {
  const ctx = await getOrganizationContext();
  const [{ plan, access, subscription }, plans] = await Promise.all([getOrganizationEntitlements(), listPlansForSale()]);
  const canManageBilling = hasPermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

  // "Current plan" means one that's paid for and running — a trial of Pro
  // still offers Pro, since choosing it is how the trial becomes a plan.
  const paying = access.state === 'active' && (subscription?.status === 'ACTIVE' || subscription?.status === 'PAST_DUE');
  const current =
    paying && subscription?.planId && subscription.billingCycle
      ? { planId: subscription.planId, cycle: subscription.billingCycle }
      : null;

  return (
    <>
      <PageHeader
        title="Plans"
        description={
          current
            ? `You're on ${plan.name}. Changing plan starts the new one straight away.`
            : 'Choose the plan that fits your business. Pay monthly, every 6 months or yearly — the longer you pay for, the less it costs.'
        }
      />
      <PageBody>
        <UpgradeWizard
          plans={plans}
          current={current}
          canManageBilling={canManageBilling}
        />
      </PageBody>
    </>
  );
}
