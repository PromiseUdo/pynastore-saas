'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Clock, Percent, Store, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { ExportCsvButton } from '@/components/dashboard/export-csv-button';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { AgingRow, ProfitabilityReport, SellThroughRow } from '@/features/inventory/actions';
import type { StoreSalesReport } from '@/features/sales/store-sales';

export type AdvancedView = 'aging' | 'sell-through' | 'profit' | 'by-store';

const TABS = [
  { key: 'aging', label: 'Sitting too long' },
  { key: 'sell-through', label: 'How fast it sells' },
  { key: 'profit', label: 'What you made' },
  { key: 'by-store', label: 'Which store sells' },
];

/** Each report says, in one line, what it measures and how. */
const EXPLAINER: Record<AdvancedView, string> = {
  aging: 'Stock that hasn’t moved in or out for 90 days or more — cash sitting on a shelf.',
  'sell-through':
    'Of what arrived in the period, how much sold. 100% means everything received also sold; a low number means it’s piling up.',
  profit: 'Revenue from issued invoices in the period, minus what those goods cost you at the time they were sold.',
  'by-store':
    'Goods that left each store’s shelf in the period, at the price the customer paid — counter sales and the website together. Delivery and discount codes belong to the whole order, so they are left out, and returns are not deducted.',
};

type Props = {
  view: AdvancedView;
  days: number;
  periods: number[];
  aging: AgingRow[];
  sellThrough: SellThroughRow[];
  profitability: ProfitabilityReport;
  byStore: StoreSalesReport;
};

function periodLabel(days: number): string {
  if (days === 365) return 'Last 12 months';
  if (days === 180) return 'Last 6 months';
  return `Last ${days} days`;
}

export function AdvancedReportsPageClient({ view, days, periods, aging, sellThrough, profitability, byStore }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setDays(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === '30') next.delete('days');
    else next.set('days', value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const agingRows = aging.filter((r) => r.isAging);
  const agingUnits = agingRows.reduce((sum, r) => sum + r.quantity, 0);
  const sold = sellThrough.reduce((sum, r) => sum + r.unitsSold, 0);
  const received = sellThrough.reduce((sum, r) => sum + r.unitsReceived, 0);
  const overallRate = received > 0 ? Math.round((sold / received) * 100) : null;
  const marginPct =
    profitability.totalRevenue > 0 ? Math.round((profitability.totalMargin / profitability.totalRevenue) * 100) : null;

  return (
    <>
      <div className="border-b bg-background px-4 pt-4 sm:px-6">
        <Link href="/inventory/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Reports
        </Link>
      </div>

      <PageHeader
        title="Sales-based reports"
        description="What your stock is doing over time: what's stuck, what's selling, and what it earned."
      />

      <PageToolbar className="gap-y-2">
        <PageTabs tabs={TABS} current={view} />
      </PageToolbar>

      <PageToolbar>
        {view !== 'aging' && (
          <div className="w-44">
            <SelectRoot value={String(days)} onValueChange={setDays}>
              <SelectTrigger aria-label="Period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {periodLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>
        )}
        <div className="ml-auto">
          {view === 'aging' && (
            <ExportCsvButton
              name="Stock sitting too long"
              rows={agingRows}
              columns={[
                { header: 'Product', value: (r) => r.itemName },
                { header: 'SKU', value: (r) => r.sku },
                { header: 'Store', value: (r) => r.warehouseName },
                { header: 'On hand', value: (r) => r.quantity },
                { header: 'Days since last movement', value: (r) => r.daysSinceLastActivity },
                { header: 'Last movement', value: (r) => (r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : '') },
              ]}
            />
          )}
          {view === 'sell-through' && (
            <ExportCsvButton
              name={`Sell-through ${days} days`}
              rows={sellThrough}
              columns={[
                { header: 'Product', value: (r) => r.itemName },
                { header: 'SKU', value: (r) => r.sku },
                { header: 'Store', value: (r) => r.warehouseName },
                { header: 'Units received', value: (r) => r.unitsReceived },
                { header: 'Units sold', value: (r) => r.unitsSold },
                { header: 'Sell-through %', value: (r) => (r.sellThroughRate === null ? '' : Math.round(r.sellThroughRate * 100)) },
              ]}
            />
          )}
          {view === 'by-store' && (
            <ExportCsvButton
              name={`Sales by store ${days} days`}
              rows={byStore.rows}
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
          )}
          {view === 'profit' && (
            <ExportCsvButton
              name={`Profit ${days} days`}
              rows={profitability.rows}
              columns={[
                { header: 'Product', value: (r) => r.itemName },
                { header: 'SKU', value: (r) => r.sku },
                { header: 'Units sold', value: (r) => r.unitsSold },
                { header: 'Revenue', value: (r) => r.revenue },
                { header: 'Cost', value: (r) => r.cost },
                { header: 'Profit', value: (r) => r.margin },
                { header: 'Margin %', value: (r) => (r.marginRatio === null ? '' : Math.round(r.marginRatio * 100)) },
              ]}
            />
          )}
        </div>
      </PageToolbar>

      <PageBody className="space-y-5">
        <p className="text-sm text-muted-foreground">{EXPLAINER[view]}</p>

        {view === 'aging' && (
          <>
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
              <StatCard title="Products not moving" value={formatNumber(agingRows.length)} icon={Clock} description="90+ days without a movement" />
              <StatCard title="Units affected" value={formatNumber(agingUnits)} icon={Clock} description="sitting on shelves" />
            </StatGrid>
            {agingRows.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="Nothing is gathering dust"
                description="Every product with stock has moved in the last 90 days."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader>Product</TableColumnHeader>
                      <TableColumnHeader>Store</TableColumnHeader>
                      <TableColumnHeader align="right">On hand</TableColumnHeader>
                      <TableColumnHeader align="right">Days still</TableColumnHeader>
                      <TableColumnHeader>Last movement</TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {agingRows.map((r) => (
                      <TableRow key={`${r.itemId}-${r.warehouseId}`}>
                        <TableCell className="py-2">
                          <span className="font-medium text-foreground">{r.itemName}</span>
                          <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                        </TableCell>
                        <TableCell muted>{r.warehouseName}</TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatNumber(r.quantity)}
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {r.daysSinceLastActivity === null ? '—' : formatNumber(r.daysSinceLastActivity)}
                        </TableCell>
                        <TableCell muted className="whitespace-nowrap">
                          {r.lastActivityAt ? formatDate(r.lastActivityAt) : 'Never moved'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </>
        )}

        {view === 'sell-through' && (
          <>
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                title="Sell-through"
                value={overallRate === null ? '—' : `${overallRate}%`}
                icon={Percent}
                description={periodLabel(days).toLowerCase()}
              />
              <StatCard title="Units received" value={formatNumber(received)} icon={TrendingUp} />
              <StatCard title="Units sold" value={formatNumber(sold)} icon={TrendingUp} />
            </StatGrid>
            {sellThrough.length === 0 ? (
              <EmptyState
                icon={Percent}
                title="No stock arrived or sold in this period"
                description="Try a longer period, or receive a purchase order and issue an invoice to see this fill in."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader>Product</TableColumnHeader>
                      <TableColumnHeader>Store</TableColumnHeader>
                      <TableColumnHeader align="right">Received</TableColumnHeader>
                      <TableColumnHeader align="right">Sold</TableColumnHeader>
                      <TableColumnHeader align="right">Sell-through</TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sellThrough.map((r) => {
                      const pct = r.sellThroughRate === null ? null : Math.round(r.sellThroughRate * 100);
                      return (
                        <TableRow key={`${r.itemId}-${r.warehouseId}`}>
                          <TableCell className="py-2">
                            <span className="font-medium text-foreground">{r.itemName}</span>
                            <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                          </TableCell>
                          <TableCell muted>{r.warehouseName}</TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatNumber(r.unitsReceived)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatNumber(r.unitsSold)}
                          </TableCell>
                          <TableCell align="right">
                            {pct === null ? (
                              <span className="text-xs text-muted-foreground">Nothing received</span>
                            ) : (
                              <Badge variant={pct >= 70 ? 'success' : pct >= 30 ? 'warning' : 'destructive'}>{pct}%</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </>
        )}

        {view === 'profit' && (
          <>
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Revenue" value={formatMoney(profitability.totalRevenue)} icon={TrendingUp} description={periodLabel(days).toLowerCase()} />
              <StatCard title="Cost of goods" value={formatMoney(profitability.totalCost)} icon={TrendingUp} />
              <StatCard title="Profit" value={formatMoney(profitability.totalMargin)} icon={TrendingUp} />
              <StatCard title="Margin" value={marginPct === null ? '—' : `${marginPct}%`} icon={Percent} description="profit ÷ revenue" />
            </StatGrid>
            {profitability.rows.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No sales in this period"
                description="Issue an invoice and its profit shows up here, using what the goods cost you on the day they sold."
              />
            ) : (
              <>
                <TableWrapper>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableColumnHeader>Product</TableColumnHeader>
                        <TableColumnHeader align="right">Units sold</TableColumnHeader>
                        <TableColumnHeader align="right">Revenue</TableColumnHeader>
                        <TableColumnHeader align="right">Cost</TableColumnHeader>
                        <TableColumnHeader align="right">Profit</TableColumnHeader>
                        <TableColumnHeader align="right">Margin</TableColumnHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {profitability.rows.map((r) => (
                        <TableRow key={r.itemId}>
                          <TableCell className="py-2">
                            <span className="font-medium text-foreground">{r.itemName}</span>
                            <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatNumber(r.unitsSold)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatMoney(r.revenue)}
                          </TableCell>
                          <TableCell align="right" muted className="tabular-nums">
                            {formatMoney(r.cost)}
                          </TableCell>
                          <TableCell align="right" className={r.margin < 0 ? 'tabular-nums text-destructive' : 'tabular-nums'}>
                            {formatMoney(r.margin)}
                          </TableCell>
                          <TableCell align="right">
                            {r.marginRatio === null ? (
                              '—'
                            ) : (
                              (() => {
                                const pct = Math.round(r.marginRatio * 100);
                                return (
                                  <Badge variant={pct < 0 ? 'destructive' : pct < 15 ? 'warning' : 'success'}>{pct}%</Badge>
                                );
                              })()
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrapper>
                {/* Said out loud rather than hidden: the number depends on when
                  * the invoice was raised, and on the cost captured that day. */}
                <p className="text-xs text-muted-foreground">
                  Counted by invoice date, and using each product’s average cost at the moment it was invoiced. Draft invoices
                  aren’t included.
                </p>
              </>
            )}
          </>
        )}

        {view === 'by-store' && (
          <>
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                title="Sold across every store"
                value={formatMoney(byStore.totals.goodsValue)}
                icon={Store}
                description={periodLabel(days).toLowerCase()}
              />
              <StatCard title="Orders" value={formatNumber(byStore.totals.orderCount)} icon={TrendingUp} description="not counting cancelled ones" />
              <StatCard title="Units sold" value={formatNumber(byStore.totals.unitsSold)} icon={Store} description="off every shelf" />
            </StatGrid>

            {byStore.rows.length === 0 ? (
              <EmptyState
                icon={Store}
                title="No stores yet"
                description="Stock is counted per store, so add the places you keep goods and their sales will be compared here."
              />
            ) : (
              <>
                <TableWrapper>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableColumnHeader>Store</TableColumnHeader>
                        <TableColumnHeader align="right">Sales</TableColumnHeader>
                        <TableColumnHeader align="right" className="hidden sm:table-cell">
                          Counter
                        </TableColumnHeader>
                        <TableColumnHeader align="right" className="hidden sm:table-cell">
                          Online
                        </TableColumnHeader>
                        <TableColumnHeader align="right">Units</TableColumnHeader>
                        <TableColumnHeader align="right">Orders</TableColumnHeader>
                        <TableColumnHeader align="right">Share</TableColumnHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {byStore.rows.map((r) => (
                        <TableRow key={r.warehouseId}>
                          <TableCell className="py-2">
                            <Link href={`/inventory/warehouses/${r.warehouseId}`} className="font-medium text-foreground hover:underline">
                              {r.warehouseName}
                            </Link>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              {!r.isOpen && <Badge variant="muted">Closed</Badge>}
                              {r.sellsOnline ? 'Sells online too' : 'Counter only'}
                            </p>
                          </TableCell>
                          <TableCell align="right" className="font-medium tabular-nums">
                            {formatMoney(r.goodsValue)}
                          </TableCell>
                          <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                            {formatMoney(r.counterValue)}
                          </TableCell>
                          <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                            {formatMoney(r.onlineValue)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatNumber(r.unitsSold)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatNumber(r.orderCount)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {byStore.totals.goodsValue === 0 ? '—' : `${Math.round(r.shareRatio * 100)}%`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrapper>

                {/* What the table cannot tell you, said out loud (AGENTS §10). */}
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    An order filled from two stores counts for both, each with its own share of the goods — so the store rows add up to
                    the total above, while the order counts do not.
                  </p>
                  {byStore.unattributed.orderCount > 0 && (
                    <p>
                      {formatNumber(byStore.unattributed.orderCount)} order
                      {byStore.unattributed.orderCount === 1 ? '' : 's'} worth {formatMoney(byStore.unattributed.goodsValue)} can&apos;t be
                      credited to any store — nothing was held for them, or the hold was given back. They are missing from the rows above.
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
