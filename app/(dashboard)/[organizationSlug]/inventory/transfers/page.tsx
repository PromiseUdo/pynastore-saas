import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listTransfers, listStockableItems, listWarehouses } from '@/features/inventory/actions';
import { TransfersPageClient } from './_components/TransfersPageClient';

export const metadata: Metadata = { title: 'Transfers' };

export default async function TransfersPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return <AccessDenied what="transfers" />;
  }

  const [transfersResult, itemsResult, warehousesResult] = await Promise.all([
    listTransfers(),
    listStockableItems(),
    listWarehouses(),
  ]);

  if (!transfersResult.success) throw new Error(transfersResult.error);

  return (
    <TransfersPageClient
      transfers={transfersResult.data}
      items={itemsResult.success ? itemsResult.data : []}
      warehouses={warehousesResult.success ? warehousesResult.data : []}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_MOVEMENT_CREATE)}
    />
  );
}
