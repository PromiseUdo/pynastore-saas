import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getFulfillment } from '@/features/sales/actions';
import { FulfillmentDetailClient } from './_components/FulfillmentDetailClient';

export default async function FulfillmentDetailPage({
  params,
}: {
  params: Promise<{ fulfillmentId: string }>;
}) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const { fulfillmentId } = await params;

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="this fulfillment" />;
  }

  const result = await getFulfillment(fulfillmentId);
  if (!result.success) {
    notFound();
  }

  return (
    <FulfillmentDetailClient
      fulfillment={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_FULFILLMENT_MANAGE)}
    />
  );
}
