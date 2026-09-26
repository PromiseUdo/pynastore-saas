import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listPurchaseOrders, listSuppliers } from '@/features/procurement/actions';
import { listStockableItems, listWarehouses } from '@/features/inventory/actions';
import { PurchaseOrdersPageClient } from './_components/PurchaseOrdersPageClient';

export default async function PurchaseOrdersPage() {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW)) {
    return <AccessDenied what="purchase orders" />;
  }

  const [posResult, suppliersResult, itemsResult, warehousesResult] = await Promise.all([
    listPurchaseOrders(),
    listSuppliers(),
    listStockableItems(),
    listWarehouses(),
  ]);

  if (!posResult.success) {
    throw new Error(posResult.error);
  }

  return (
    <PurchaseOrdersPageClient
      purchaseOrders={posResult.data}
      suppliers={suppliersResult.success ? suppliersResult.data : []}
      warehouses={warehousesResult.success ? warehousesResult.data : []}
      items={itemsResult.success ? itemsResult.data : []}
      canCreate={hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_CREATE)}
      organizationSlug={ctx.organization.slug}
    />
  );
}
