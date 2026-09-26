import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getPurchaseOrder } from '@/features/procurement/actions';
import { PODetailClient } from './_components/PODetailClient';

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  const ctx = await getOrganizationContext();
  const { poId } = await params;

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW)) {
    return <AccessDenied what="this purchase order" />;
  }

  const result = await getPurchaseOrder(poId);
  if (!result.success) {
    notFound();
  }

  return (
    <PODetailClient
      po={result.data}
      can={{
        edit: hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_EDIT),
        approve: hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_APPROVE),
        reject: hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_REJECT),
        receive: hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_RECEIVE),
      }}
    />
  );
}
