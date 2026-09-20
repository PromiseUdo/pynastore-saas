import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listCollections } from '@/features/inventory/actions';
import { CollectionsPageClient } from './_components/CollectionsPageClient';

export const metadata: Metadata = { title: 'Collections' };

export default async function CollectionsPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) return <AccessDenied what="collections" />;

  const result = await listCollections();
  if (!result.success) throw new Error(result.error);

  return (
    <CollectionsPageClient
      collections={result.data}
      canManage={hasPermission(perms, PERMISSIONS.INVENTORY_CATEGORY_MANAGE)}
    />
  );
}
