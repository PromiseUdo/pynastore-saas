import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { previewReorderDrafts } from '@/features/procurement/actions';
import { listWarehouses } from '@/features/inventory/actions';
import { ReorderPageClient } from './_components/ReorderPageClient';

export const metadata: Metadata = { title: 'Reorder suggestions' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value || undefined);

export default async function ReorderPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  await requireFeature(FEATURES.PROCUREMENT_AUTO_REORDER);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW)) {
    return <AccessDenied what="reorder suggestions" />;
  }

  // One store, when a store's own low-stock panel sent the merchant here.
  const storeId = one((await searchParams).store);
  const [result, warehouses] = await Promise.all([previewReorderDrafts(storeId), listWarehouses()]);
  if (!result.success) {
    throw new Error(result.error);
  }

  const store = storeId ? (warehouses.success ? warehouses.data.find((w) => w.id === storeId) : undefined) : undefined;

  return (
    <ReorderPageClient
      groups={result.data}
      storeName={store?.name ?? null}
      canGenerate={hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_CREATE)}
    />
  );
}
