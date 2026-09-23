/*
 * One campaign: what it covers, and what it did.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { getCampaign } from '@/features/marketing/campaign-reads';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { prisma } from '@/lib/prisma';
import { CampaignDetailClient } from './_components/CampaignDetailClient';

export const metadata: Metadata = { title: 'Campaign' };

export default async function CampaignPage({ params }: { params: Promise<{ campaignId: string }> }) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.SALES_VIEW)) return <AccessDenied what="campaigns" />;

  const { campaignId } = await params;
  const result = await getCampaign(campaignId);
  if (!result.success) notFound();

  /*
   * Real places on this merchant's store, for the announcement's link.
   *
   * The form used to be a free-text path with `/sale` suggested — which
   * quietly sent shoppers to a collection most stores don't have. A link in
   * an announcement should be one that exists.
   */
  const [collections, categories, storePages] = await Promise.all([
    prisma.collection.findMany({
      where: { organizationId: ctx.organization.id, isVisible: true },
      select: { name: true, slug: true },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({
      where: { organizationId: ctx.organization.id, isVisible: true },
      select: { id: true, name: true, slug: true, parentId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.storePage.findMany({
      where: { organizationId: ctx.organization.id, isPublished: true },
      select: { title: true, slug: true },
      orderBy: { title: 'asc' },
    }),
  ]);

  /* A category's address is the chain of slugs down to it. */
  const bySlugPath = (id: string): string[] => {
    const path: string[] = [];
    let current = categories.find((c) => c.id === id);
    while (current) {
      path.unshift(current.slug);
      current = current.parentId ? categories.find((c) => c.id === current!.parentId) : undefined;
    }
    return path;
  };

  const destinations = [
    { label: 'All products', href: '/products' },
    ...collections.map((c) => ({ label: `Collection · ${c.name}`, href: `/collections/${c.slug}` })),
    ...categories.map((c) => ({ label: `Category · ${c.name}`, href: `/c/${bySlugPath(c.id).join('/')}` })),
    ...storePages.map((p) => ({ label: `Page · ${p.title}`, href: `/pages/${p.slug}` })),
  ];

  return (
    <CampaignDetailClient
      campaign={result.data}
      currency={ctx.organization.currency}
      canManage={hasPermission(perms, PERMISSIONS.SALES_DISCOUNT_MANAGE)}
      storeName={ctx.organization.name}
      storeUrl={getStorefrontUrl(ctx.organization.slug)}
      destinations={destinations}
    />
  );
}
