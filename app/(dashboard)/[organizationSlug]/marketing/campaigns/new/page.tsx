/*
 * Marketing → Campaigns → New.
 *
 * A full page, not a dialog: choosing what goes on sale is a list-shaped job
 * (AGENTS §4), and the point of the screen is the preview — seeing every
 * price that will change, before any of them does.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { prisma } from '@/lib/prisma';
import { NewCampaignForm } from './_components/NewCampaignForm';

export const metadata: Metadata = { title: 'New campaign' };

export default async function NewCampaignPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_DISCOUNT_MANAGE)) {
    return <AccessDenied what="campaigns" />;
  }

  /* Collections and categories are small lists a business has a handful of —
   * unlike products, which are searched. */
  const [collections, categories] = await Promise.all([
    prisma.collection.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <NewCampaignForm
      collections={collections}
      categories={categories}
      currency={ctx.organization.currency}
    />
  );
}
