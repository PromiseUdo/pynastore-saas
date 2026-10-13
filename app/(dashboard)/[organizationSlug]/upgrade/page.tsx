import type { Metadata } from 'next';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { getOrganizationContext } from '@/lib/organization';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { listPlansForSale } from '@/lib/billing/catalogue';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { UpgradeWizard } from './_components/UpgradeWizard';
import { Badge } from '@/components/ui/badge';
import { isBusinessAppRequest } from '@/lib/business-app/request';
import { ACCESS_BADGE, planStatusLine } from '@/lib/billing/status-line';
import { FEATURE_INFO, type FeatureKey } from '@/lib/billing/plans';

export const metadata: Metadata = { title: 'Plans' };

export default async function UpgradePage({ searchParams }: { searchParams: Promise<{ feature?: string }> }) {
  const ctx = await getOrganizationContext();

  /* Inside the business app nothing is sold, and nothing points to where it
   * could be (ROADMAP 19.3): this page only says what the shop has — and,
   * when a locked page sent them here, that it isn't on the plan. */
  if (await isBusinessAppRequest()) {
    const [{ plan, access, subscription }, { feature }] = await Promise.all([getOrganizationEntitlements(), searchParams]);
    const locked = feature && Object.hasOwn(FEATURE_INFO, feature) ? FEATURE_INFO[feature as FeatureKey] : null;
    const badge = ACCESS_BADGE[access.state];
    return (
      <>
        <PageHeader title="Your plan" description="What this shop’s plan includes. Plans can’t be changed in the app." />
        <PageBody className="max-w-2xl space-y-4">
          {locked && (
            <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-foreground">
              <span className="font-medium">{locked.label}</span> — {locked.description.toLowerCase()} — isn’t on your plan.
            </p>
          )}
          <div className="rounded-lg border bg-card p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">{plan.id !== null ? `${plan.name} plan` : 'No plan yet'}</h2>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{planStatusLine({ access, subscription, noBuying: true })}</p>
          </div>
        </PageBody>
      </>
    );
  }

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
