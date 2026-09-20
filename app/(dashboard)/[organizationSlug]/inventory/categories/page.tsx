import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listCategories } from '@/features/inventory/actions';
import { AccessDenied } from '@/components/layout/access-denied';
import { CategoriesPageClient } from './_components/CategoriesPageClient';

export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return <AccessDenied what="categories" />;
  }

  const result = await listCategories();
  if (!result.success) {
    // Thrown so the segment's error boundary shows a friendly retry.
    throw new Error(result.error);
  }

  return (
    <CategoriesPageClient
      categories={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE)}
    />
  );
}
