import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { previewReorderDrafts } from '@/features/procurement/actions';
import { ReorderPageClient } from './_components/ReorderPageClient';

export default async function ReorderPage() {
  await requireFeature(FEATURES.PROCUREMENT_MODULE);
  await requireFeature(FEATURES.PROCUREMENT_AUTO_REORDER);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view reorder suggestions.
        </p>
      </div>
    );
  }

  const result = await previewReorderDrafts();
  if (!result.success) {
    throw new Error(result.error);
  }

  return (
    <ReorderPageClient
      groups={result.data}
      canGenerate={hasPermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_CREATE)}
    />
  );
}
