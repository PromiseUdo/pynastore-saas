import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listCategories } from '@/features/inventory/actions';
import { CollectionForm } from '../_components/CollectionForm';

export const metadata: Metadata = { title: 'New collection' };

export default async function NewCollectionPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_CATEGORY_MANAGE)) return <AccessDenied what="creating collections" />;

  const categories = await listCategories();
  return <CollectionForm collection={null} categories={categories.success ? categories.data : []} canSave />;
}
