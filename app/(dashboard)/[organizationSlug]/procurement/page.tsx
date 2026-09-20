import Link from 'next/link';
import { ClipboardList, Building2, Sparkles, ArrowUpRight } from 'lucide-react';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { listPurchaseOrders, listSuppliers, previewReorderDrafts } from '@/features/procurement/actions';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export default async function ProcurementDashboardPage() {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view procurement.
        </p>
      </div>
    );
  }

  const [posResult, suppliersResult, reorderResult] = await Promise.all([
    listPurchaseOrders(),
    listSuppliers(),
    previewReorderDrafts(),
  ]);

  const pos = posResult.success ? posResult.data : [];
  const openCount = pos.filter((po) => !['RECEIVED', 'CANCELLED', 'REJECTED'].includes(po.status)).length;
  const supplierCount = suppliersResult.success ? suppliersResult.data.length : 0;
  const reorderItemCount = reorderResult.success ? reorderResult.data.reduce((sum, g) => sum + g.items.length, 0) : 0;

  return (
    <div className="space-y-6 px-6 py-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Procurement</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Suppliers, purchase orders, and restock automation.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/procurement/purchase-orders">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Open purchase orders</CardTitle>
                <p className="mt-1 text-2xl font-semibold text-foreground">{openCount}</p>
              </div>
              <ClipboardList className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
        <Link href="/procurement/suppliers">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Suppliers</CardTitle>
                <p className="mt-1 text-2xl font-semibold text-foreground">{supplierCount}</p>
              </div>
              <Building2 className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
        <Link href="/procurement/reorder">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Items to reorder</CardTitle>
                <p className="mt-1 text-2xl font-semibold text-foreground">{reorderItemCount}</p>
              </div>
              <Sparkles className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
      </div>

      {reorderItemCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span className="text-amber-800 dark:text-amber-300">
            {reorderItemCount} item{reorderItemCount === 1 ? ' is' : 's are'} at or below its reorder point.
          </span>
          <Link
            href="/procurement/reorder"
            className="flex items-center gap-1 font-medium text-amber-800 hover:underline dark:text-amber-300"
          >
            Review suggestions <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
