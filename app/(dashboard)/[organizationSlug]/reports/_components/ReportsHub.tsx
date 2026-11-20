'use client';

/*
 * The reports hub (ROADMAP 14.6). One period for every view, the view in the
 * URL, the few figures that matter first, then the table — and each view
 * says in one line what it counts and what it leaves out (AGENTS §10).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, BadgePercent, Boxes, History, Lock, Package, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { UpgradeLink } from '@/components/business-app/no-buying';
import { buttonVariants } from '@/components/ui/button-variants';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { ExportCsvButton } from '@/components/dashboard/export-csv-button';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { bucketLabel, changePct, type ReportPreset } from '@/lib/reports/period';
import type { DiscountsReport, RevenueReport, TopCustomersReport, TopProductsReport } from '@/features/reports/sales-reports';
import type { StoreSalesReport } from '@/features/sales/store-sales';
import { PeriodPicker } from './PeriodPicker';
import { SalesChart } from './SalesChart';
import { StoreSalesView } from './StoreSalesView';
import { MoneyOwedView, TradeView } from './TradeViews';
import type { MoneyOwedReport, TradeReport } from '@/features/reports/trade-reports';

export type ReportsView = 'sales' | 'products' | 'customers' | 'discounts' | 'by-store' | 'trade' | 'owed';

export type ReportsData =
  | { view: 'sales'; report: RevenueReport }
  | { view: 'products'; report: TopProductsReport }
  | { view: 'customers'; report: TopCustomersReport }
  | { view: 'discounts'; report: DiscountsReport }
  | { view: 'by-store'; report: StoreSalesReport }
  /** wholesale (ROADMAP 21.8): retail vs trade and the top trade buyers; what's owed, by age */
  | { view: 'trade'; report: TradeReport }
  | { view: 'owed'; report: MoneyOwedReport }
  /** a view this plan doesn't include: shown with what it does, not hidden (AGENTS §7) */
  | { view: 'locked'; locked: 'discounts' | 'by-store' };

/**
 * The stock reports (/inventory/reports), which the hub links to rather than
 * repeats. 'hidden': this member can't see stock, or the plan has no inventory.
 */
export interface StockReportsAccess {
  onHand: boolean;
  /** "Stock over time" is an Advanced report: shown locked rather than hidden (AGENTS §7) */
  overTime: 'open' | 'locked' | 'hidden';
}

export interface ReportsPeriodView {
  key: ReportPreset | 'custom';
  firstDay: string;
  lastDay: string;
  today: string;
  /** "1 Oct 2026 – 30 Oct 2026" */
  label: string;
}

const EXPLAINER: Record<ReportsView, string> = {
  sales:
    'Every order placed in the period — online, at the counter and by phone — at what the customer was charged: after discounts, with delivery and VAT. Cancelled orders are left out; refunds are shown beside the sales, not taken off.',
  products:
    'What each product sold in the period: units, and the price charged for them, sale prices included. Discount codes and counter discounts belong to the whole order, so they aren’t spread over the products.',
  customers:
    'Who spent the most in the period, by order total. A customer is “new” when their first order ever was in this period. Counter sales nobody took a name for are counted separately.',
  discounts:
    'What discount codes and counter discounts took off orders placed in the period, and what each campaign’s sale prices gave away below the usual price while it ran.',
  'by-store':
    'Goods that left each store’s shelf in the period, at the price the customer paid — counter sales and the website together. Delivery and discount codes belong to the whole order, so they are left out, and returns are not deducted.',
  trade:
    'Orders placed in the period by your approved wholesalers, beside everyone else’s — at what was charged, with delivery and VAT, cancelled orders left out. “Owes you now” is today’s figure, not the period’s.',
  owed:
    'What customers owe you today — orders on a wholesaler’s account and invoices you’ve sent, less what you’ve recorded receiving — by how late it is. The period above doesn’t apply: this is where things stand now. Something with no due date counts as not due.',
};

const LOCKED_COPY: Record<'discounts' | 'by-store', { title: string; description: string }> = {
  discounts: {
    title: 'See what your discounts cost and earned',
    description:
      'Advanced reports show every discount code and campaign side by side: the orders each brought in, and what it gave away to get them.',
  },
  'by-store': {
    title: 'Compare your stores',
    description:
      'Advanced reports show what each store sold — at the counter and online — so you can see which shop is pulling its weight.',
  },
};

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function ReportsHub({
  view,
  tabs,
  period,
  data,
  stock,
}: {
  view: ReportsView;
  tabs: { key: ReportsView; label: string; locked?: boolean }[];
  period: ReportsPeriodView;
  data: ReportsData;
  stock: StockReportsAccess;
}) {
  const periodText = period.label;
  const fileSuffix = `${period.firstDay} to ${period.lastDay}`;

  return (
    <>
      <PageHeader title="Reports" description="How the business is doing: what sold, who bought it, and what it took to sell it." />

      <PageToolbar className="gap-y-2">
        <PageTabs tabs={tabs} current={view} />
      </PageToolbar>

      <PageToolbar className="gap-y-2">
        {/* Money owed is today's position, not a period's. */}
        {view !== 'owed' && (
          <>
            <PeriodPicker current={period.key} firstDay={period.firstDay} lastDay={period.lastDay} today={period.today} />
            <p className="text-xs text-muted-foreground tabular-nums">{periodText}</p>
          </>
        )}
        <div className="ml-auto">{data.view !== 'locked' && <ExportFor data={data} suffix={fileSuffix} />}</div>
      </PageToolbar>

      <PageBody className="space-y-5">
        <p className="text-sm text-muted-foreground">{EXPLAINER[view]}</p>

        {data.view === 'locked' && (
          <EmptyState
            icon={Lock}
            title={LOCKED_COPY[data.locked].title}
            description={LOCKED_COPY[data.locked].description}
            action={
              <UpgradeLink href="/upgrade?feature=reports.advanced" className={buttonVariants({ size: 'sm' })}>
                See plans
              </UpgradeLink>
            }
          />
        )}
        {data.view === 'sales' && <SalesView report={data.report} periodText={periodText} />}
        {data.view === 'products' && <ProductsView report={data.report} />}
        {data.view === 'customers' && <CustomersView report={data.report} />}
        {data.view === 'discounts' && <DiscountsView report={data.report} />}
        {data.view === 'by-store' && <StoreSalesView report={data.report} periodLabel={periodText} />}
        {data.view === 'trade' && <TradeView report={data.report} />}
        {data.view === 'owed' && <MoneyOwedView report={data.report} />}

        <StockReportLinks stock={stock} />
      </PageBody>
    </>
  );
}

/** For a member who can see stock but not sales: the hub is just its stock reports. */
export function StockReportsOnly({ stock }: { stock: StockReportsAccess }) {
  return (
    <>
      <PageHeader title="Reports" description="What you hold and what it's worth." />
      <PageBody>
        <StockReportLinks stock={stock} />
      </PageBody>
    </>
  );
}

function StockReportLinks({ stock }: { stock: StockReportsAccess }) {
  if (!stock.onHand && stock.overTime === 'hidden') return null;
  const card =
    'flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <section aria-labelledby="stock-reports" className="space-y-2 border-t pt-5">
      <h2 id="stock-reports" className="text-sm font-semibold">
        Stock reports
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {stock.onHand && (
          <Link href="/inventory/reports" className={card}>
            <Boxes className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Stock on hand</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                What you hold in each store, what it’s worth, and what needs restocking.
              </span>
            </span>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}
        {stock.overTime === 'open' && (
          <Link href="/inventory/reports/advanced" className={card}>
            <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Stock over time</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                What’s stuck on the shelf, what’s selling through, and what each product earned.
              </span>
            </span>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}
        {stock.overTime === 'locked' && (
          <UpgradeLink href="/upgrade?feature=reports.advanced" className={card}>
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Stock over time</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                What’s stuck, what’s selling through and what each product earned. Part of Advanced reports — see
                plans.
              </span>
            </span>
          </UpgradeLink>
        )}
      </div>
    </section>
  );
}

// ── Spreadsheets, matching what's on screen ──────────────────────────────

function ExportFor({ data, suffix }: { data: Exclude<ReportsData, { view: 'locked' }>; suffix: string }) {
  switch (data.view) {
    case 'sales':
      return (
        <ExportCsvButton
          name={`Sales ${suffix}`}
          rows={data.report.buckets}
          columns={[
            { header: data.report.unit === 'day' ? 'Day' : 'Month', value: (r) => r.key },
            { header: 'Online', value: (r) => r.online },
            { header: 'In store', value: (r) => r.inStore },
            { header: 'Phone', value: (r) => r.phone },
            { header: 'Sales', value: (r) => r.sales },
            { header: 'Orders', value: (r) => r.orders },
          ]}
        />
      );
    case 'products':
      return (
        <ExportCsvButton
          name={`Top products ${suffix}`}
          rows={data.report.rows}
          columns={[
            { header: 'Product', value: (r) => r.name },
            { header: 'SKU', value: (r) => r.sku ?? '' },
            { header: 'Units sold', value: (r) => r.unitsSold },
            { header: 'Orders', value: (r) => r.orders },
            { header: 'Sales', value: (r) => r.revenue },
            { header: 'Online sales', value: (r) => r.onlineRevenue },
            { header: 'Share %', value: (r) => Math.round(r.shareRatio * 100) },
          ]}
        />
      );
    case 'customers':
      return (
        <ExportCsvButton
          name={`Top customers ${suffix}`}
          rows={data.report.rows}
          columns={[
            { header: 'Customer', value: (r) => r.name },
            { header: 'Email', value: (r) => r.email ?? '' },
            { header: 'Orders', value: (r) => r.orders },
            { header: 'Spent', value: (r) => r.spend },
            { header: 'Last order', value: (r) => r.lastOrderAt },
            { header: 'New customer', value: (r) => (r.isNew ? 'Yes' : 'No') },
          ]}
        />
      );
    case 'discounts':
      return (
        <ExportCsvButton
          name={`Discounts ${suffix}`}
          rows={[
            ...data.report.codes.map((r) => ({
              kind: 'Discount code',
              name: r.code,
              orders: r.orders,
              given: r.discountGiven,
              sales: r.sales,
            })),
            ...(data.report.counter.orders > 0
              ? [
                  {
                    kind: 'Counter discount',
                    name: 'Given at the counter',
                    orders: data.report.counter.orders,
                    given: data.report.counter.discountGiven,
                    sales: null as number | null,
                  },
                ]
              : []),
            ...data.report.campaigns.map((r) => ({
              kind: 'Campaign',
              name: r.name,
              orders: r.orders,
              given: r.discountGiven,
              sales: r.revenue as number | null,
            })),
          ]}
          columns={[
            { header: 'Type', value: (r) => r.kind },
            { header: 'Name', value: (r) => r.name },
            { header: 'Orders', value: (r) => r.orders },
            { header: 'Given away', value: (r) => r.given },
            { header: 'Sales', value: (r) => (r.sales === null ? '' : r.sales) },
          ]}
        />
      );
    case 'trade':
      return (
        <ExportCsvButton
          name={`Wholesalers ${suffix}`}
          rows={data.report.rows}
          columns={[
            { header: 'Wholesaler', value: (r) => r.businessName },
            { header: 'Orders', value: (r) => r.orders },
            { header: 'Spent', value: (r) => r.spend },
            { header: 'Owes now', value: (r) => r.owed },
            { header: 'Last order', value: (r) => r.lastOrderAt },
          ]}
        />
      );
    case 'owed':
      return (
        <ExportCsvButton
          name="Money owed"
          rows={data.report.rows}
          columns={[
            { header: 'Customer', value: (r) => r.name },
            { header: 'Wholesaler', value: (r) => (r.trade ? 'Yes' : 'No') },
            { header: 'Not due yet', value: (r) => r.ages.notDue },
            { header: '1–30 days late', value: (r) => r.ages.days1to30 },
            { header: '31–60 days late', value: (r) => r.ages.days31to60 },
            { header: 'Over 60 days late', value: (r) => r.ages.over60 },
            { header: 'Owed', value: (r) => r.owed },
            { header: 'Oldest due', value: (r) => r.oldestDueAt ?? '' },
          ]}
        />
      );
    case 'by-store':
      return (
        <ExportCsvButton
          name={`Sales by store ${suffix}`}
          rows={data.report.rows}
          columns={[
            { header: 'Store', value: (r) => r.warehouseName },
            { header: 'Open', value: (r) => (r.isOpen ? 'Yes' : 'No') },
            { header: 'Sells online', value: (r) => (r.sellsOnline ? 'Yes' : 'No') },
            { header: 'Sales', value: (r) => r.goodsValue },
            { header: 'Counter sales', value: (r) => r.counterValue },
            { header: 'Online sales', value: (r) => r.onlineValue },
            { header: 'Units sold', value: (r) => r.unitsSold },
            { header: 'Orders', value: (r) => r.orderCount },
            { header: 'Share %', value: (r) => Math.round(r.shareRatio * 100) },
          ]}
        />
      );
  }
}

// ── Sales by day and channel ─────────────────────────────────────────────

function trendOf(current: number, before: number) {
  const change = changePct(current, before);
  return change === null ? undefined : { value: change, label: 'vs the period before' };
}

function SalesView({ report, periodText }: { report: RevenueReport; periodText: string }) {
  const { totals } = report;
  const channels = [
    { key: 'online' as const, label: 'Online store' },
    { key: 'inStore' as const, label: 'In store' },
    { key: 'phone' as const, label: 'Phone orders' },
  ];

  if (totals.orders === 0) {
    return (
      <>
        <EmptyState
          icon={ShoppingBag}
          title="No sales in this period"
          description={
            report.previous.orders > 0
              ? `There were ${formatNumber(report.previous.orders)} orders in the period before this one. Try a longer period.`
              : 'Orders from your online store and sales rung up in a store show here, day by day.'
          }
          action={
            <Link href="/sales/orders" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              Go to orders
            </Link>
          }
        />
      </>
    );
  }

  const rows = [...report.buckets].reverse();

  return (
    <>
      <StatGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Sales"
          value={formatMoney(totals.sales)}
          icon={TrendingUp}
          trend={trendOf(totals.sales, report.previous.sales)}
          description={report.previous.sales > 0 ? undefined : periodText}
        />
        <StatCard
          title="Orders"
          value={formatNumber(totals.orders)}
          icon={ShoppingBag}
          trend={trendOf(totals.orders, report.previous.orders)}
        />
        <StatCard
          title="Average order"
          value={totals.averageOrder === null ? '—' : formatMoney(totals.averageOrder)}
          icon={TrendingUp}
          description="sales ÷ orders"
        />
        <StatCard
          title="Not paid yet"
          value={formatMoney(totals.unpaid)}
          icon={Wallet}
          description="included in sales: pay on delivery, transfers waiting"
        />
      </StatGrid>

      <div className="grid gap-3 sm:grid-cols-3">
        {channels.map((channel) => {
          const value = totals.byChannel[channel.key];
          const orders = totals.ordersByChannel[channel.key];
          return (
            <div key={channel.key} className="rounded-lg border bg-card px-4 py-3 shadow-xs">
              <p className="text-xs text-muted-foreground">{channel.label}</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{formatMoney(value)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatNumber(orders)} order{orders === 1 ? '' : 's'}
                {totals.sales > 0 && ` · ${pct(value / totals.sales)} of sales`}
              </p>
            </div>
          );
        })}
      </div>

      <SalesChart buckets={report.buckets} unit={report.unit} />

      <dl className="grid gap-x-6 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm shadow-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Discounts given" value={formatMoney(totals.discounts)} />
        <Fact label="Delivery charged" value={formatMoney(totals.delivery)} />
        <Fact label="VAT included" value={totals.vat > 0 ? formatMoney(totals.vat) : '—'} />
        <Fact label="Refunds recorded" value={formatMoney(totals.refunds)} />
      </dl>

      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableColumnHeader primary>{report.unit === 'day' ? 'Day' : 'Month'}</TableColumnHeader>
              <TableColumnHeader align="right" className="hidden sm:table-cell">
                Online
              </TableColumnHeader>
              <TableColumnHeader align="right" className="hidden sm:table-cell">
                In store
              </TableColumnHeader>
              <TableColumnHeader align="right" className="hidden sm:table-cell">
                Phone
              </TableColumnHeader>
              <TableColumnHeader align="right">Orders</TableColumnHeader>
              <TableColumnHeader align="right">Sales</TableColumnHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="whitespace-nowrap">{bucketLabel(r.key, report.unit)}</TableCell>
                <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                  {r.online ? formatMoney(r.online) : '—'}
                </TableCell>
                <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                  {r.inStore ? formatMoney(r.inStore) : '—'}
                </TableCell>
                <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                  {r.phone ? formatMoney(r.phone) : '—'}
                </TableCell>
                <TableCell align="right" className="tabular-nums">
                  {formatNumber(r.orders)}
                </TableCell>
                <TableCell align="right" className="font-medium tabular-nums">
                  {formatMoney(r.sales)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>

      <p className="text-xs text-muted-foreground">
        Counted on the day each order was placed, Lagos time. The comparison is with the same number of days just before this period.
      </p>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ── Top products ─────────────────────────────────────────────────────────

function ProductsView({ report }: { report: TopProductsReport }) {
  const router = useRouter();

  return (
    <>
      <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Goods sold" value={formatMoney(report.totals.revenue)} icon={TrendingUp} description="before order discounts and delivery" />
        <StatCard title="Units sold" value={formatNumber(report.totals.unitsSold)} icon={Package} />
        <StatCard title="Products that sold" value={formatNumber(report.productCount)} icon={Package} />
      </StatGrid>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nothing sold in this period"
          description="When orders come in, the products that earn the most rise to the top here. Try a longer period."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader className="w-10">#</TableColumnHeader>
                  <TableColumnHeader primary>Product</TableColumnHeader>
                  <TableColumnHeader align="right">Units</TableColumnHeader>
                  <TableColumnHeader align="right" className="hidden sm:table-cell">
                    Orders
                  </TableColumnHeader>
                  <TableColumnHeader align="right">Sales</TableColumnHeader>
                  <TableColumnHeader align="right" className="hidden sm:table-cell">
                    Share
                  </TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.rows.map((r, i) => (
                  <TableRow
                    key={r.productId ?? `deleted-${r.name}`}
                    clickable={Boolean(r.productId)}
                    onClick={r.productId ? () => router.push(`/inventory/products/${r.productId}`) : undefined}
                  >
                    <TableCell muted className="tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell className="py-2">
                      {r.productId ? (
                        <Link
                          href={`/inventory/products/${r.productId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-foreground hover:underline"
                        >
                          {r.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{r.name}</span>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {r.productId ? (r.sku ? <span className="font-mono">{r.sku}</span> : '—') : 'No longer in your catalogue'}
                      </p>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {formatNumber(r.unitsSold)}
                    </TableCell>
                    <TableCell align="right" className="hidden tabular-nums sm:table-cell">
                      {formatNumber(r.orders)}
                    </TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">
                      {formatMoney(r.revenue)}
                    </TableCell>
                    <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                      {pct(r.shareRatio)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
          {report.productCount > report.rows.length && (
            <p className="text-xs text-muted-foreground">
              Showing the top {formatNumber(report.rows.length)} of {formatNumber(report.productCount)} products that sold.
            </p>
          )}
        </>
      )}
    </>
  );
}

// ── Top customers ────────────────────────────────────────────────────────

function CustomersView({ report }: { report: TopCustomersReport }) {
  const router = useRouter();
  const returning = report.customerCount - report.newCustomers;

  return (
    <>
      <StatGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Customers who bought" value={formatNumber(report.customerCount)} icon={Users} />
        <StatCard
          title="New customers"
          value={formatNumber(report.newCustomers)}
          icon={Users}
          description={`${formatNumber(returning)} came back from before`}
        />
        <StatCard title="Ordered more than once" value={formatNumber(report.repeatCustomers)} icon={Users} description="in this period" />
        <StatCard
          title="Sales with no name"
          value={formatMoney(report.anonymous.spend)}
          icon={ShoppingBag}
          description={`${formatNumber(report.anonymous.orders)} counter sale${report.anonymous.orders === 1 ? '' : 's'}`}
        />
      </StatGrid>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No named customers bought in this period"
          description="Online orders always have a customer; at the counter, add the customer to a sale to see them here."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader className="w-10">#</TableColumnHeader>
                  <TableColumnHeader primary>Customer</TableColumnHeader>
                  <TableColumnHeader align="right">Orders</TableColumnHeader>
                  <TableColumnHeader align="right">Spent</TableColumnHeader>
                  <TableColumnHeader className="hidden sm:table-cell">Last order</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.rows.map((r, i) => (
                  <TableRow key={r.customerId} clickable onClick={() => router.push(`/sales/customers/${r.customerId}`)}>
                    <TableCell muted className="tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/sales/customers/${r.customerId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-foreground hover:underline"
                        >
                          {r.name}
                        </Link>
                        {r.isNew && <Badge variant="info">New</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{r.email ?? '—'}</p>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {formatNumber(r.orders)}
                    </TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">
                      {formatMoney(r.spend)}
                    </TableCell>
                    <TableCell muted className="hidden whitespace-nowrap sm:table-cell">
                      {formatDate(r.lastOrderAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
          {report.customerCount > report.rows.length && (
            <p className="text-xs text-muted-foreground">
              Showing the top {formatNumber(report.rows.length)} of {formatNumber(report.customerCount)} customers who bought.
            </p>
          )}
        </>
      )}
    </>
  );
}

// ── Discounts and campaigns ──────────────────────────────────────────────

function DiscountsView({ report }: { report: DiscountsReport }) {
  const router = useRouter();
  const nothing = report.codes.length === 0 && report.counter.orders === 0 && report.campaigns.length === 0;

  return (
    <>
      <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Taken off orders"
          value={formatMoney(report.totals.orderDiscounts)}
          icon={BadgePercent}
          description="discount codes and counter discounts"
        />
        <StatCard
          title="Given away by sale prices"
          value={formatMoney(report.totals.campaignDiscounts)}
          icon={BadgePercent}
          description="below the usual price, while campaigns ran"
        />
        <StatCard title="Orders using a code" value={formatNumber(report.totals.ordersWithCode)} icon={ShoppingBag} />
      </StatGrid>

      {nothing ? (
        <EmptyState
          icon={BadgePercent}
          title="No discounts in this period"
          description="Discount codes customers use, discounts given at the counter and campaigns that ran show here, with what each one brought in."
          action={
            <Link href="/marketing/campaigns" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              Go to campaigns
            </Link>
          }
        />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Discount codes</h2>
            {report.codes.length === 0 && report.counter.orders === 0 ? (
              <p className="text-sm text-muted-foreground">
                No orders used a code in this period.{' '}
                <Link href="/sales/discounts" className="font-medium text-primary hover:underline">
                  Manage discount codes
                </Link>
              </p>
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader primary>Code</TableColumnHeader>
                      <TableColumnHeader className="hidden sm:table-cell">Campaign</TableColumnHeader>
                      <TableColumnHeader align="right">Orders</TableColumnHeader>
                      <TableColumnHeader align="right">Taken off</TableColumnHeader>
                      <TableColumnHeader align="right" className="hidden sm:table-cell">
                        Orders came to
                      </TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.codes.map((r) => (
                      <TableRow key={r.discountCodeId ?? `deleted-${r.code}`}>
                        <TableCell className="py-2">
                          <span className="font-mono text-sm font-medium text-foreground">{r.code}</span>
                          <p className="text-xs text-muted-foreground">
                            {r.discountCodeId ? (r.label ?? '—') : 'This code has since been deleted'}
                          </p>
                        </TableCell>
                        <TableCell muted className="hidden sm:table-cell">
                          {r.campaignName ?? '—'}
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatNumber(r.orders)}
                        </TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {formatMoney(r.discountGiven)}
                        </TableCell>
                        <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                          {formatMoney(r.sales)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {report.counter.orders > 0 && (
                      <TableRow>
                        <TableCell className="py-2">
                          <span className="font-medium text-foreground">Given at the counter</span>
                          <p className="text-xs text-muted-foreground">Whole-sale discounts with no code</p>
                        </TableCell>
                        <TableCell muted className="hidden sm:table-cell">
                          —
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatNumber(report.counter.orders)}
                        </TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {formatMoney(report.counter.discountGiven)}
                        </TableCell>
                        <TableCell align="right" muted className="hidden sm:table-cell">
                          —
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Campaigns</h2>
            {report.campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No campaign ran in this period.{' '}
                <Link href="/marketing/campaigns" className="font-medium text-primary hover:underline">
                  Go to campaigns
                </Link>
              </p>
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader primary>Campaign</TableColumnHeader>
                      <TableColumnHeader align="right">Orders</TableColumnHeader>
                      <TableColumnHeader align="right" className="hidden sm:table-cell">
                        Units
                      </TableColumnHeader>
                      <TableColumnHeader align="right">Sales</TableColumnHeader>
                      <TableColumnHeader align="right">Given away</TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.campaigns.map((r) => (
                      <TableRow key={r.campaignId} clickable onClick={() => router.push(`/marketing/campaigns/${r.campaignId}`)}>
                        <TableCell className="py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link
                              href={`/marketing/campaigns/${r.campaignId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-foreground hover:underline"
                            >
                              {r.name}
                            </Link>
                            <Badge variant={r.isRunning ? 'success' : 'completed'}>{r.isRunning ? 'Running' : 'Finished'}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {r.offer} · {formatDate(r.startsAt)} – {r.endsAt ? formatDate(r.endsAt) : 'until stopped'}
                          </p>
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatNumber(r.orders)}
                        </TableCell>
                        <TableCell align="right" className="hidden tabular-nums sm:table-cell">
                          {formatNumber(r.unitsSold)}
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatMoney(r.revenue)}
                        </TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {formatMoney(r.discountGiven)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            A campaign counts only the days of this period it was running, and only its products&apos; lines. “Given away” is the usual
            price it replaced minus what was charged. An order can use a code and campaign prices at once, so the two totals above can
            overlap in the same order but never count the same naira.
          </p>
        </>
      )}
    </>
  );
}
