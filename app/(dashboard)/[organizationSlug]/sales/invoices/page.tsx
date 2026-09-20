import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listInvoices, listCustomers } from '@/features/sales/actions';
import { listStockableItems, listWarehouses } from '@/features/inventory/actions';
import { InvoicesPageClient } from './_components/InvoicesPageClient';

export default async function InvoicesPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view invoices.
        </p>
      </div>
    );
  }

  const [invoicesResult, customersResult, warehousesResult, itemsResult] = await Promise.all([
    listInvoices(),
    listCustomers(),
    listWarehouses(),
    listStockableItems(),
  ]);

  if (!invoicesResult.success) {
    throw new Error(invoicesResult.error);
  }

  return (
    <InvoicesPageClient
      invoices={invoicesResult.data}
      customers={customersResult.success ? customersResult.data : []}
      warehouses={warehousesResult.success ? warehousesResult.data : []}
      items={itemsResult.success ? itemsResult.data : []}
      canCreate={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_CREATE)}
    />
  );
}
