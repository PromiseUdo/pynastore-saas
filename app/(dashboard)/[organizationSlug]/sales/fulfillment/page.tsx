import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listFulfillments } from '@/features/sales/actions';
import { FulfillmentPageClient } from './_components/FulfillmentPageClient';

export default async function FulfillmentPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="fulfillment" />;
  }

  const result = await listFulfillments();
  if (!result.success) {
    throw new Error(result.error);
  }

  return <FulfillmentPageClient fulfillments={result.data} />;
}
