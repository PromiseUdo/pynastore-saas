/*
 * Sales → Fulfillment: one "to send" list (ROADMAP 12.4) — online order
 * parcels waiting to go out, and invoices being picked, packed and shipped —
 * each opening where it's handled. Filters, search and page live in the URL.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { listToSend, type SourceFilter, type ToSendFilter } from '@/features/sales/work-lists';
import { FulfillmentPageClient } from './_components/FulfillmentPageClient';

export const metadata: Metadata = { title: 'Fulfillment' };

type Props = { searchParams: Promise<{ status?: string; source?: string; q?: string; page?: string }> };

export default async function FulfillmentPage({ searchParams }: Props) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="fulfillment" />;
  }
  const params = await searchParams;
  const filter: ToSendFilter = params.status === 'done' || params.status === 'all' ? params.status : 'open';
  const source: SourceFilter = params.source === 'order' || params.source === 'invoice' ? params.source : 'all';
  const q = params.q?.trim() ?? '';
  const result = await listToSend({ filter, source, q, page: Number(params.page) || 1 });
  if (!result.success) throw new Error(result.error);
  return <FulfillmentPageClient data={result.data} filter={filter} source={source} q={q} />;
}
