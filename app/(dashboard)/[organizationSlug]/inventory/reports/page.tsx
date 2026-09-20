import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature, getOrganizationEntitlements, hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import {
  getLowStockReport,
  getStockLevelsReport,
  getStockValuationReport,
  listWarehouses,
} from '@/features/inventory/actions';
import { ReportsPageClient, type ReportView } from './_components/ReportsPageClient';

export const metadata: Metadata = { title: 'Reports' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);
const VIEWS: ReportView[] = ['levels', 'valuation', 'low-stock'];

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return <AccessDenied what="inventory reports" />;
  }

  const raw = await searchParams;
  const viewParam = one(raw.view);
  const view: ReportView = VIEWS.includes(viewParam as ReportView) ? (viewParam as ReportView) : 'levels';
  const storeId = one(raw.store);

  // Filtered in the query, so a store's report is that store's numbers.
  const [levels, valuation, lowStock, warehouses, { plan }] = await Promise.all([
    getStockLevelsReport(storeId),
    getStockValuationReport(storeId),
    getLowStockReport(storeId),
    listWarehouses(),
    getOrganizationEntitlements(),
  ]);
  if (!levels.success) throw new Error(levels.error);
  if (!valuation.success) throw new Error(valuation.error);
  if (!lowStock.success) throw new Error(lowStock.error);

  return (
    <ReportsPageClient
      view={view}
      storeId={storeId ?? null}
      stockLevels={levels.data}
      valuation={valuation.data}
      lowStock={lowStock.data}
      warehouses={warehouses.success ? warehouses.data : []}
      advancedEnabled={hasFeature(plan, FEATURES.REPORTS_ADVANCED)}
      canSeeAdvanced={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)}
    />
  );
}
