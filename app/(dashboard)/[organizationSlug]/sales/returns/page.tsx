/*
 * Sales → Returns: one list (ROADMAP 12.4) — online-store returns, answered
 * on their order, and returns raised against an invoice — each marked where
 * it came from and opening where it's handled. Filters, search and page
 * live in the URL.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listAllReturns, type ReturnsFilter, type SourceFilter } from '@/features/sales/work-lists';
import { ReturnsPageClient } from './_components/ReturnsPageClient';

export const metadata: Metadata = { title: 'Returns' };

type Props = { searchParams: Promise<{ status?: string; source?: string; q?: string; page?: string; view?: string }> };

export default async function ReturnsPage({ searchParams }: Props) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="returns" />;
  }
  const params = await searchParams;
  const filter: ReturnsFilter = params.status === 'all' ? 'all' : 'open';
  // Old links used ?view=invoices; they now narrow the one list.
  const source: SourceFilter =
    params.source === 'order' || params.source === 'invoice' ? params.source : params.view === 'invoices' ? 'invoice' : 'all';
  const q = params.q?.trim() ?? '';
  const result = await listAllReturns({ filter, source, q, page: Number(params.page) || 1 });
  if (!result.success) throw new Error(result.error);
  return <ReturnsPageClient data={result.data} filter={filter} source={source} q={q} />;
}
