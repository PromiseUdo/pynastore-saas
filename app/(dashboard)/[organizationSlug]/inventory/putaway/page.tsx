import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getPutawayQueue, listWarehouses } from '@/features/inventory/actions';
import { PutawayPageClient } from './_components/PutawayPageClient';

export const metadata: Metadata = { title: 'Putaway' };

export default async function PutawayPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return <AccessDenied what="shelf locations" />;
  }

  const [rowsResult, warehousesResult] = await Promise.all([getPutawayQueue(), listWarehouses()]);

  if (!rowsResult.success) throw new Error(rowsResult.error);

  return (
    <PutawayPageClient
      rows={rowsResult.data}
      warehouses={warehousesResult.success ? warehousesResult.data : []}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT)}
    />
  );
}
