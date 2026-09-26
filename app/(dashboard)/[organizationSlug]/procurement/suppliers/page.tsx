import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature, getOrganizationEntitlements, hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listSuppliers } from '@/features/procurement/actions';
import { SuppliersPageClient } from './_components/SuppliersPageClient';

export default async function SuppliersPage() {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_VIEW)) {
    return <AccessDenied what="suppliers" />;
  }

  const [result, { plan }] = await Promise.all([listSuppliers(), getOrganizationEntitlements()]);
  if (!result.success) {
    throw new Error(result.error);
  }

  return (
    <SuppliersPageClient
      suppliers={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_EDIT)}
      /* A supplier's only detail page is its performance report, which is a Pro
         feature — so rows lead there only when they can, rather than bouncing
         the merchant to /upgrade with no explanation (AGENTS §7). */
      performanceEnabled={hasFeature(plan, FEATURES.REPORTS_ADVANCED)}
      organizationSlug={ctx.organization.slug}
    />
  );
}
