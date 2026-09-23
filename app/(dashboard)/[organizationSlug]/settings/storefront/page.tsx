/*
 * Settings → Storefront.
 *
 * What the merchant's own shop looks like, and how it appears when someone
 * links to it. Until now every storefront opened the same way, because there
 * was nowhere to say anything of their own.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getStorefrontAppearance } from '@/features/settings/storefront';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { prisma } from '@/lib/prisma';
import { StorefrontSettingsClient } from './_components/StorefrontSettingsClient';

export const metadata: Metadata = { title: 'Storefront' };

export default async function StorefrontSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="storefront settings" />;

  const result = await getStorefrontAppearance();
  if (!result.success) throw new Error(result.error);

  /* Real places a slide's button can point at — the same reasoning as a
   * campaign announcement: a typed path is a 404 waiting for a customer. */
  const [collections, categories, pages] = await Promise.all([
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

  const pathFor = (id: string): string[] => {
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
    ...categories.map((c) => ({ label: `Category · ${c.name}`, href: `/c/${pathFor(c.id).join('/')}` })),
    ...pages.map((p) => ({ label: `Page · ${p.title}`, href: `/pages/${p.slug}` })),
  ];

  return (
    <StorefrontSettingsClient
      appearance={result.data.appearance}
      slides={result.data.slides}
      destinations={destinations}
      storeUrl={getStorefrontUrl(ctx.organization.slug)}
      canManage={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)}
    />
  );
}
