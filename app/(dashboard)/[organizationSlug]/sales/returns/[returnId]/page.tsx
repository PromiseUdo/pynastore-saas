import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getReturn } from '@/features/sales/actions';
import { ReturnDetailClient } from './_components/ReturnDetailClient';

export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const { returnId } = await params;

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="this return" />;
  }

  const result = await getReturn(returnId);
  if (!result.success) {
    notFound();
  }

  return (
    <ReturnDetailClient
      returnRequest={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_RETURN_MANAGE)}
    />
  );
}
