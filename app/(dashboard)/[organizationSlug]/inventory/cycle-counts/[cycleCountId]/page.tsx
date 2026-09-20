import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getCycleCount } from '@/features/inventory/actions';
import { CycleCountDetailClient } from './_components/CycleCountDetailClient';

export default async function CycleCountDetailPage({
  params,
}: {
  params: Promise<{ cycleCountId: string }>;
}) {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const { cycleCountId } = await params;

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view this cycle count.
        </p>
      </div>
    );
  }

  const result = await getCycleCount(cycleCountId);
  if (!result.success) {
    notFound();
  }

  return (
    <CycleCountDetailClient
      cycleCount={result.data}
      canManage={hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CYCLE_COUNT_MANAGE)}
    />
  );
}
