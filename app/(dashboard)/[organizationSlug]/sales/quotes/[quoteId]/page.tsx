import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getQuote } from '@/features/sales/actions';
import { listWarehouses } from '@/features/inventory/actions';
import { QuoteDetailClient } from './_components/QuoteDetailClient';

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const { quoteId } = await params;

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view this quote.
        </p>
      </div>
    );
  }

  const [result, warehousesResult] = await Promise.all([getQuote(quoteId), listWarehouses()]);
  if (!result.success) {
    notFound();
  }

  return (
    <QuoteDetailClient
      quote={result.data}
      warehouses={warehousesResult.success ? warehousesResult.data : []}
      can={{
        edit: hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_QUOTE_EDIT),
        convert: hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_CREATE),
      }}
    />
  );
}
