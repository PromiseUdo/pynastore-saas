import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listCustomers } from '@/features/sales/actions';
import { CustomersPageClient } from './_components/CustomersPageClient';

export default async function CustomersPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view customers.
        </p>
      </div>
    );
  }

  const result = await listCustomers();
  if (!result.success) {
    throw new Error(result.error);
  }

  return (
    <CustomersPageClient
      customers={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_EDIT)}
    />
  );
}
