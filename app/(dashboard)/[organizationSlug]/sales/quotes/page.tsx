import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listQuotes, listCustomers } from '@/features/sales/actions';
import { listStockableItems } from '@/features/inventory/actions';
import { QuotesPageClient } from './_components/QuotesPageClient';

export default async function QuotesPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="quotes" />;
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
