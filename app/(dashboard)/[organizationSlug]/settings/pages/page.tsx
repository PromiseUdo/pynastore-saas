/*
 * Settings → Store pages.
 *
 * The online store's About, Delivery and returns, FAQ, Size guide, Contact,
 * Terms and Privacy pages, plus any others — written by the merchant, served
 * at /pages/{web address} once published (features/settings/store-pages.ts).
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { AccessDenied } from '@/components/layout/access-denied';
import { listStorePages } from '@/features/settings/store-pages';
import { StorePagesClient } from './_components/StorePagesClient';

export const metadata: Metadata = { title: 'Store pages' };

export default async function StorePagesPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="store pages" />;

  const result = await listStorePages();
  if (!result.success) throw new Error(result.error);

  return (
    <StorePagesClient
      pages={result.data}
      canManage={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)}
      storeUrl={getStorefrontUrl(ctx.organization.slug, '').replace(/\/$/, '')}
    />
  );
}
