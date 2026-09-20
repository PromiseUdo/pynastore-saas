import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { getCollection, listCategories } from '@/features/inventory/actions';
import { CollectionForm } from '../_components/CollectionForm';

type Props = { params: Promise<{ collectionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { collectionId } = await params;
  const result = await getCollection(collectionId);
  return { title: result.success ? result.data.name : 'Collection' };
}

export default async function CollectionPage({ params }: Props) {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) return <AccessDenied what="collections" />;

  const { collectionId } = await params;
  const [result, categories] = await Promise.all([getCollection(collectionId), listCategories()]);
  if (!result.success) {
    if (result.error === 'Collection not found') notFound();
    throw new Error(result.error);
  }

  return (
    <CollectionForm
      key={result.data.id}
      collection={result.data}
      categories={categories.success ? categories.data : []}
      canSave={hasPermission(perms, PERMISSIONS.INVENTORY_CATEGORY_MANAGE)}
    />
  );
}
