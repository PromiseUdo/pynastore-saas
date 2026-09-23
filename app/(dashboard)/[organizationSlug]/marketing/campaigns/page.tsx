/*
 * Marketing → Campaigns.
 *
 * A campaign is a sale with a calendar: chosen products, a discount, and a
 * window. It prices what it covers when it is scheduled and stops by itself
 * when the window closes — nothing has to be turned off by hand, which is
 * the failure that costs a shop real money.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listCampaigns } from '@/features/marketing/campaign-reads';
import { CampaignsPageClient } from './_components/CampaignsPageClient';

export const metadata: Metadata = { title: 'Campaigns' };

export default async function CampaignsPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.SALES_VIEW)) return <AccessDenied what="campaigns" />;

  const result = await listCampaigns();
  if (!result.success) throw new Error(result.error);

  return (
    <CampaignsPageClient
      campaigns={result.data}
      currency={ctx.organization.currency}
      canManage={hasPermission(perms, PERMISSIONS.SALES_DISCOUNT_MANAGE)}
    />
  );
}
