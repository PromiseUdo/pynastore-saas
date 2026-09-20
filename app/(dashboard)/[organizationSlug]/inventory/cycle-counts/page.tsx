import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listCycleCounts, listWarehouses, listStockableItems } from '@/features/inventory/actions';
import { CycleCountsPageClient } from './_components/CycleCountsPageClient';

export const metadata: Metadata = { title: 'Stock counts' };

export default async function CycleCountsPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return <AccessDenied what="stock counts" />;
  }

  const [cycleCountsResult, warehousesResult, itemsResult] = await Promise.all([
    listCycleCounts(),
    listWarehouses(),
    listStockableItems(),
  ]);

  if (!cycleCountsResult.success) throw new Error(cycleCountsResult.error);

  return (
    <CycleCountsPageClient
      cycleCounts={cycleCountsResult.data}
      warehouses={warehousesResult.success ? warehousesResult.data : []}
      items={itemsResult.success ? itemsResult.data : []}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE)}
      organizationSlug={ctx.organization.slug}
    />
  );
}
