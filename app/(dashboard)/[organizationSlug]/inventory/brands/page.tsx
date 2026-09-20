import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listBrands } from '@/features/inventory/actions';
import { BrandsPageClient } from './_components/BrandsPageClient';

export const metadata: Metadata = { title: 'Brands' };

export default async function BrandsPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) return <AccessDenied what="brands" />;

  const result = await listBrands();
  if (!result.success) throw new Error(result.error);

  return (
    <BrandsPageClient
      brands={result.data}
      canManage={
        hasPermission(perms, PERMISSIONS.INVENTORY_CATEGORY_MANAGE) || hasPermission(perms, PERMISSIONS.INVENTORY_CREATE)
      }
    />
  );
}
