import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { getAgingInventoryReport, getSellThroughReport, getProfitabilityReport } from '@/features/inventory/actions';
import { AdvancedReportsPageClient, type AdvancedView } from './_components/AdvancedReportsPageClient';

export const metadata: Metadata = { title: 'Sales-based reports' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);
const VIEWS: AdvancedView[] = ['aging', 'sell-through', 'profit'];
/** "Which store sells" moved to the reports hub (ROADMAP 14.6); old links land there. */
const HUB_RANGE: Record<number, string> = { 30: '', 90: '&range=90d', 365: '&range=12m' };
const PERIODS = [30, 60, 90, 180, 365];

export default async function AdvancedReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  if (one(raw.view) === 'by-store') {
    redirect(`/reports?view=by-store${HUB_RANGE[Number(one(raw.days))] ?? ''}`);
  }
  await requireFeature(FEATURES.INVENTORY_MODULE);
  await requireFeature(FEATURES.REPORTS_ADVANCED);
  const ctx = await getOrganizationContext();

  if (
    !hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW) ||
    !hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)
  ) {
    return <AccessDenied what="sales-based reports" />;
  }

  const viewParam = one(raw.view);
  const view: AdvancedView = VIEWS.includes(viewParam as AdvancedView) ? (viewParam as AdvancedView) : 'aging';
  const periodParam = Number(one(raw.days));
  const days = PERIODS.includes(periodParam) ? periodParam : 30;

  const since = new Date(Date.now() - days * 86_400_000);
  const [aging, sellThrough, profitability] = await Promise.all([
    getAgingInventoryReport(),
    getSellThroughReport({ sinceDays: days }),
    getProfitabilityReport({ dateFrom: since }),
  ]);
  if (!aging.success) throw new Error(aging.error);
  if (!sellThrough.success) throw new Error(sellThrough.error);
  if (!profitability.success) throw new Error(profitability.error);

  return (
    <AdvancedReportsPageClient
      view={view}
      days={days}
      periods={PERIODS}
      aging={aging.data}
      sellThrough={sellThrough.data}
      profitability={profitability.data}
    />
  );
}
