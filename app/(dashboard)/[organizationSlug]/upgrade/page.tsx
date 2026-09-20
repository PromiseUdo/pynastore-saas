import type { Metadata } from 'next';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { getOrganizationContext } from '@/lib/organization';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { PLANS, PLAN_ORDER } from '@/lib/billing/plans';
import { getRootDomain } from '@/lib/tenant/resolveHostname';
import { UpgradeWizard } from './_components/UpgradeWizard';

export const metadata: Metadata = { title: 'Upgrade plan' };

export default async function UpgradePage() {
  const ctx = await getOrganizationContext();
  const { plan } = await getOrganizationEntitlements();
  const canManageBilling = hasPermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

  return (
    <>
      <PageHeader
        title="Plans & pricing"
        description="Upgrade to unlock more modules, seats, workspace limits, and custom domain support."
      />
      <PageBody>
        <UpgradeWizard
          plans={PLAN_ORDER.map((key) => PLANS[key])}
          currentPlan={plan}
          canManageBilling={canManageBilling}
          orgSlug={ctx.organization.slug}
          rootDomain={getRootDomain()}
        />
      </PageBody>
    </>
  );
}
