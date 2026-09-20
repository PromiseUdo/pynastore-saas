import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listSuppliers } from '@/features/procurement/actions';
import { SuppliersPageClient } from './_components/SuppliersPageClient';

export default async function SuppliersPage() {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view suppliers.
        </p>
      </div>
    );
  }

  const result = await listSuppliers();
  if (!result.success) {
    throw new Error(result.error);
  }

  return (
    <SuppliersPageClient
      suppliers={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SUPPLIER_EDIT)}
      organizationSlug={ctx.organization.slug}
    />
  );
}
