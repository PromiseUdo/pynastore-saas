import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature, getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { FEATURES, getPlanLimit } from '@/lib/billing/plans';
import { listWarehouses } from '@/features/inventory/actions';
import { AccessDenied } from '@/components/layout/access-denied';
import { WarehousesPageClient } from './_components/WarehousesPageClient';

export default async function WarehousesPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return <AccessDenied what="stores" />;
  }

  const [result, { plan }] = await Promise.all([listWarehouses(), getOrganizationEntitlements()]);
  if (!result.success) {
    throw new Error(result.error);
  }

  return (
    <WarehousesPageClient
      warehouses={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CREATE)}
      canEdit={hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT)}
      maxWarehouses={getPlanLimit(plan, 'maxWarehouses')}
      organizationSlug={ctx.organization.slug}
    />
  );
}
