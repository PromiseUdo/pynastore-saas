import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getSupplierPerformance } from '@/features/procurement/actions';
import { SupplierPerformanceClient } from './_components/SupplierPerformanceClient';

export default async function SupplierPerformancePage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  await requireFeature(FEATURES.REPORTS_ADVANCED);
  const ctx = await getOrganizationContext();
  const { supplierId } = await params;

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view supplier performance.
        </p>
      </div>
    );
  }

  const result = await getSupplierPerformance(supplierId);
  if (!result.success) {
    throw new Error(result.error);
  }

  return <SupplierPerformanceClient performance={result.data} />;
}
