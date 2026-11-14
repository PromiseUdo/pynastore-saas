import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { getOrganizationEntitlements, hasFeature, requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { formatDate } from '@/lib/format';
import { lagosDay, resolvePeriod, startOfLagosDay } from '@/lib/reports/period';
import {
  getDiscountsReport,
  getRevenueReport,
  getTopCustomersReport,
  getTopProductsReport,
} from '@/features/reports/sales-reports';
import { getSalesByStore } from '@/features/sales/store-sales';
import { ReportsHub, StockReportsOnly, type ReportsData, type ReportsView, type StockReportsAccess } from './_components/ReportsHub';

export const metadata: Metadata = { title: 'Reports' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);

/*
 * The reports hub (ROADMAP 14.6). Sales, products and customers come with
 * every plan; discounts and the store comparison are Advanced reports, shown
 * with what they do rather than hidden (AGENTS §7). Only the view on screen
 * is queried. The stock reports live under /inventory/reports; the hub links
 * to them, and is all a member who sees stock but not sales gets here.
 */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  const { plan } = await getOrganizationEntitlements();
  const advanced = hasFeature(plan, FEATURES.REPORTS_ADVANCED);
  const canSeeSales = hasPermission(perms, PERMISSIONS.SALES_VIEW);
  const canSeeStock = hasFeature(plan, FEATURES.INVENTORY_MODULE) && hasPermission(perms, PERMISSIONS.INVENTORY_VIEW);
  // The same rules as the stock report pages themselves.
  const stock: StockReportsAccess = {
    onHand: canSeeStock,
    overTime: canSeeStock && canSeeSales ? (advanced ? 'open' : 'locked') : 'hidden',
  };
  if (!canSeeSales) {
    return canSeeStock ? <StockReportsOnly stock={stock} /> : <AccessDenied what="reports" />;
  }

  const canSeeCustomers = hasPermission(perms, PERMISSIONS.CUSTOMER_VIEW);

  const tabs: { key: ReportsView; label: string; locked?: boolean }[] = [
    { key: 'sales', label: 'Sales' },
    { key: 'products', label: 'Top products' },
    ...(canSeeCustomers ? [{ key: 'customers' as const, label: 'Top customers' }] : []),
    { key: 'discounts', label: 'Discounts and campaigns', locked: !advanced },
    { key: 'by-store', label: 'Which store sells', locked: !advanced },
  ];

  const raw = await searchParams;
  const asked = one(raw.view);
  const view: ReportsView = tabs.some((t) => t.key === asked) ? (asked as ReportsView) : 'sales';
  const input = { range: one(raw.range), from: one(raw.from), to: one(raw.to) };
  const period = resolvePeriod(input);

  let data: ReportsData;
  if ((view === 'discounts' || view === 'by-store') && !advanced) {
    data = { view: 'locked', locked: view };
  } else if (view === 'products') {
    data = { view, report: unwrap(await getTopProductsReport(input)) };
  } else if (view === 'customers') {
    data = { view, report: unwrap(await getTopCustomersReport(input)) };
  } else if (view === 'discounts') {
    data = { view, report: unwrap(await getDiscountsReport(input)) };
  } else if (view === 'by-store') {
    data = { view, report: unwrap(await getSalesByStore({ from: period.from, to: period.to })) };
  } else {
    data = { view: 'sales', report: unwrap(await getRevenueReport(input)) };
  }

  const first = formatDate(startOfLagosDay(period.firstDay));
  const last = formatDate(startOfLagosDay(period.lastDay));

  return (
    <ReportsHub
      view={view}
      tabs={tabs}
      period={{
        key: period.key,
        firstDay: period.firstDay,
        lastDay: period.lastDay,
        today: lagosDay(new Date()),
        label: first === last ? first : `${first} – ${last}`,
      }}
      data={data}
      stock={stock}
    />
  );
}

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}
