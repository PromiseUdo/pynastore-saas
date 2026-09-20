import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listQuotes, listCustomers } from '@/features/sales/actions';
import { listStockableItems } from '@/features/inventory/actions';
import { QuotesPageClient } from './_components/QuotesPageClient';

export default async function QuotesPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view quotes.
        </p>
      </div>
    );
  }

  const [quotesResult, customersResult, itemsResult] = await Promise.all([
    listQuotes(),
    listCustomers(),
    listStockableItems(),
  ]);

  if (!quotesResult.success) {
    throw new Error(quotesResult.error);
  }

  return (
    <QuotesPageClient
      quotes={quotesResult.data}
      customers={customersResult.success ? customersResult.data : []}
      items={itemsResult.success ? itemsResult.data : []}
      canCreate={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_QUOTE_CREATE)}
    />
  );
}
