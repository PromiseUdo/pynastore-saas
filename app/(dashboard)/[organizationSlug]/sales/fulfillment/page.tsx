import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listFulfillments } from '@/features/sales/actions';
import { FulfillmentPageClient } from './_components/FulfillmentPageClient';

export default async function FulfillmentPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view fulfillment.
        </p>
      </div>
    );
  }

  const result = await listFulfillments();
  if (!result.success) {
    throw new Error(result.error);
  }

  return <FulfillmentPageClient fulfillments={result.data} />;
}
