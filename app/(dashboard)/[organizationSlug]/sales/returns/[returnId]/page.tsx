import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
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
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view this return.
        </p>
      </div>
    );
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
