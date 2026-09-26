import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
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
    return <AccessDenied what="supplier performance" />;
  }

  const result = await getSupplierPerformance(supplierId);
  if (!result.success) {
    throw new Error(result.error);
  }

  return <SupplierPerformanceClient performance={result.data} />;
}
