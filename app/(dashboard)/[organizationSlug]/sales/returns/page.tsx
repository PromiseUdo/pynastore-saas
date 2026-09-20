/*
 * Sales → Returns.
 *
 * Two kinds of return, one page:
 *   - Online store (the default): customers asking to send back items from a
 *     delivered order, within the store's return window. Answered on the
 *     order itself, where the refund is recorded too.
 *   - Invoices: returns staff raise against an invoice.
 *
 * View, status, search and page all live in the URL.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listReturns } from '@/features/sales/actions';
import { listOrderReturns, type OrderReturnFilter } from '@/features/sales/order-returns';
import { ReturnsPageClient } from './_components/ReturnsPageClient';

export const metadata: Metadata = { title: 'Returns' };

const FILTERS: OrderReturnFilter[] = ['open', 'all', 'REQUESTED', 'APPROVED', 'REFUNDED', 'REJECTED', 'WITHDRAWN'];

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; q?: string; page?: string }>;
}) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="returns" />;
  }

  const params = await searchParams;
  const view = params.view === 'invoices' ? 'invoices' : 'online';

  if (view === 'invoices') {
    const result = await listReturns();
    if (!result.success) throw new Error(result.error);
    return <ReturnsPageClient view="invoices" invoiceReturns={result.data} />;
  }

  const filter = FILTERS.includes(params.status as OrderReturnFilter) ? (params.status as OrderReturnFilter) : 'open';
  const result = await listOrderReturns({ filter, query: params.q, page: Number(params.page) || 1 });
  if (!result.success) throw new Error(result.error);

  return <ReturnsPageClient view="online" online={result.data} filter={filter} query={params.q ?? ''} />;
}
