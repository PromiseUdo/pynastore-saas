'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Lock, PackageX, Search, Wallet, Boxes } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { ExportCsvButton } from '@/components/dashboard/export-csv-button';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { formatMoney, formatNumber } from '@/lib/format';
import type { LowStockRow, StockLevelRow, ValuationReport, WarehouseRow } from '@/features/inventory/actions';

export type ReportView = 'levels' | 'valuation' | 'low-stock';

const TABS = [
  { key: 'levels', label: 'Stock on hand' },
  { key: 'valuation', label: 'What it’s worth' },
  { key: 'low-stock', label: 'Running low' },
];

/** One line telling the reader what they're looking at and how it's worked out. */
const EXPLAINER: Record<ReportView, string> = {
  levels: 'How many units of each product sit in each store right now.',
  valuation: 'What your stock is worth at cost — quantity × the average you paid, not the price you sell at.',
  'low-stock': 'Products at or below the reorder point you set, so you can restock before you run out.',
};

type ReportsPageClientProps = {
  view: ReportView;
  storeId: string | null;
  stockLevels: StockLevelRow[];
  valuation: ValuationReport;
  lowStock: LowStockRow[];
  warehouses: WarehouseRow[];
  advancedEnabled: boolean;
  canSeeAdvanced: boolean;
};

export function ReportsPageClient({
  view,
  storeId,
  stockLevels,
  valuation,
  lowStock,
  warehouses,
  advancedEnabled,
  canSeeAdvanced,
}: ReportsPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState('');

  function setStore(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === 'all') next.delete('store');
    else next.set('store', value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const q = query.trim().toLowerCase();
  const matches = (row: { itemName: string; sku: string }) =>
    !q || row.itemName.toLowerCase().includes(q) || row.sku.toLowerCase().includes(q);

  const levels = stockLevels.filter(matches);
  const valuationRows = valuation.rows.filter(matches);
  const lowStockRows = lowStock.filter(matches);
  const storeName = storeId ? warehouses.find((w) => w.id === storeId)?.name : undefined;

  const totalUnits = levels.reduce((sum, r) => sum + r.quantity, 0);
  const trackedProducts = new Set(levels.map((r) => r.itemId)).size;
  const valuationTotal = valuationRows.reduce((sum, r) => sum + r.value, 0);
  const outOfStock = lowStockRows.filter((r) => r.quantity <= 0).length;

  const searchBox = (
    <div className="w-full sm:w-60">
      <Input
        aria-label="Search this report"
        placeholder="Search product or SKU…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        startAdornment={<Search className="size-3.5" />}
      />
    </div>
  );

  const noResults = q.length > 0;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`What you hold${storeName ? ` in ${storeName}` : ' across every store'}, what it's worth, and what needs restocking.`}
        actions={
          advancedEnabled && canSeeAdvanced ? (
            <Link
              href="/inventory/reports/advanced"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Sales-based reports <ArrowUpRight className="size-3.5" />
            </Link>
          ) : !advancedEnabled ? (
            <Link
              href="/upgrade"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              title="Aging, sell-through and profitability reports"
            >
              <Lock className="size-3.5" />
              Unlock sales-based reports
            </Link>
          ) : undefined
        }
      />

      <PageToolbar className="gap-y-2">
        <PageTabs tabs={TABS} current={view} />
      </PageToolbar>

      <PageToolbar>
        {searchBox}
        <div className="w-[calc(50%-4px)] sm:w-48">
          <SelectRoot value={storeId ?? 'all'} onValueChange={setStore}>
            <SelectTrigger aria-label="Store">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stores</SelectItem>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>
        <div className="ml-auto">
          {view === 'levels' && (
            <ExportCsvButton
              name={`Stock on hand${storeName ? ` ${storeName}` : ''}`}
              rows={levels}
              columns={[
                { header: 'Product', value: (r) => r.itemName },
                { header: 'SKU', value: (r) => r.sku },
                { header: 'Store', value: (r) => r.warehouseName },
                { header: 'Quantity', value: (r) => r.quantity },
              ]}
            />
          )}
          {view === 'valuation' && (
            <ExportCsvButton
              name={`Stock value${storeName ? ` ${storeName}` : ''}`}
              rows={valuationRows}
              columns={[
                { header: 'Product', value: (r) => r.itemName },
                { header: 'SKU', value: (r) => r.sku },
                { header: 'Store', value: (r) => r.warehouseName },
                { header: 'Quantity', value: (r) => r.quantity },
                { header: 'Average cost', value: (r) => r.averageCost },
                { header: 'Value', value: (r) => r.value },
              ]}
            />
          )}
          {view === 'low-stock' && (
            <ExportCsvButton
              name={`Running low${storeName ? ` ${storeName}` : ''}`}
              rows={lowStockRows}
              columns={[
                { header: 'Product', value: (r) => r.itemName },
                { header: 'SKU', value: (r) => r.sku },
                { header: 'Store', value: (r) => r.warehouseName },
                { header: 'On hand', value: (r) => r.quantity },
                { header: 'Reorder point', value: (r) => r.reorderPoint },
                { header: 'Suggested order', value: (r) => r.reorderQty },
              ]}
            />
          )}
        </div>
      </PageToolbar>

      <PageBody className="space-y-5">
        <p className="text-sm text-muted-foreground">{EXPLAINER[view]}</p>

        {view === 'levels' && (
          <>
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
              <StatCard title="Products in stock" value={formatNumber(trackedProducts)} icon={Boxes} description={storeName ?? 'across all stores'} />
              <StatCard title="Units on hand" value={formatNumber(totalUnits)} icon={Boxes} description="counting every store row" />
            </StatGrid>
            {levels.length === 0 ? (
              <EmptyState
                variant={noResults ? 'filtered' : 'empty'}
                icon={Boxes}
                title={noResults ? 'Nothing matches your search' : 'No stock recorded yet'}
                description={noResults ? undefined : 'Receive a purchase order or record a stock movement, and it will appear here.'}
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader>Product</TableColumnHeader>
                      <TableColumnHeader>Store</TableColumnHeader>
                      <TableColumnHeader align="right">On hand</TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {levels.map((r) => (
                      <TableRow key={`${r.itemId}-${r.warehouseId}`}>
                        <TableCell className="py-2">
                          <span className="font-medium text-foreground">{r.itemName}</span>
                          <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                        </TableCell>
                        <TableCell muted>{r.warehouseName}</TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatNumber(r.quantity)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </>
        )}

        {view === 'valuation' && (
          <>
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
              <StatCard title="Stock value" value={formatMoney(valuationTotal)} icon={Wallet} description={storeName ?? 'across all stores'} />
              <StatCard title="Products counted" value={formatNumber(new Set(valuationRows.map((r) => r.itemId)).size)} icon={Boxes} />
            </StatGrid>
            {valuationRows.length === 0 ? (
              <EmptyState
                variant={noResults ? 'filtered' : 'empty'}
                icon={Wallet}
                title={noResults ? 'Nothing matches your search' : 'Nothing to value yet'}
                description={noResults ? undefined : 'Once you receive stock at a cost, its value shows up here.'}
              />
            ) : (
              <TableWrapper>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableColumnHeader>Product</TableColumnHeader>
                      <TableColumnHeader>Store</TableColumnHeader>
                      <TableColumnHeader align="right">On hand</TableColumnHeader>
                      <TableColumnHeader align="right">Average cost</TableColumnHeader>
                      <TableColumnHeader align="right">Value</TableColumnHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {valuationRows.map((r) => (
                      <TableRow key={`${r.itemId}-${r.warehouseId}`}>
                        <TableCell className="py-2">
                          <span className="font-medium text-foreground">{r.itemName}</span>
                          <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                        </TableCell>
                        <TableCell muted>{r.warehouseName}</TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatNumber(r.quantity)}
                        </TableCell>
                        <TableCell align="right" muted className="tabular-nums">
                          {formatMoney(r.averageCost)}
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatMoney(r.value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </>
        )}

        {view === 'low-stock' && (
          <>
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
              <StatCard title="Running low" value={formatNumber(lowStockRows.length)} icon={PackageX} description="at or below reorder point" />
              <StatCard title="Out of stock" value={formatNumber(outOfStock)} icon={PackageX} description="nothing left to sell" />
            </StatGrid>
            {lowStockRows.length === 0 ? (
              <EmptyState
                variant={noResults ? 'filtered' : 'empty'}
                icon={PackageX}
                title={noResults ? 'Nothing matches your search' : 'Nothing needs restocking'}
                description={
                  noResults
                    ? undefined
                    : 'Every product is above its reorder point. Set reorder points on a product to be warned earlier.'
                }
              />
            ) : (
              <>
                <TableWrapper>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableColumnHeader>Product</TableColumnHeader>
                        <TableColumnHeader>Store</TableColumnHeader>
                        <TableColumnHeader align="right">On hand</TableColumnHeader>
                        <TableColumnHeader align="right">Reorder point</TableColumnHeader>
                        <TableColumnHeader align="right">Suggested order</TableColumnHeader>
                        <TableColumnHeader>
                          <span className="sr-only">Status</span>
                        </TableColumnHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {lowStockRows.map((r) => (
                        <TableRow key={`${r.itemId}-${r.warehouseId}`}>
                          <TableCell className="py-2">
                            <span className="font-medium text-foreground">{r.itemName}</span>
                            <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                          </TableCell>
                          <TableCell muted>{r.warehouseName}</TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatNumber(r.quantity)}
                          </TableCell>
                          <TableCell align="right" muted className="tabular-nums">
                            {formatNumber(r.reorderPoint)}
                          </TableCell>
                          <TableCell align="right" muted className="tabular-nums">
                            {r.reorderQty === null ? '—' : formatNumber(r.reorderQty)}
                          </TableCell>
                          <TableCell align="right">
                            <Badge variant={r.quantity <= 0 ? 'destructive' : 'warning'}>
                              {r.quantity <= 0 ? 'Out of stock' : 'Reorder'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrapper>
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-muted-foreground">
                    We can draft purchase orders for these, grouped by their preferred supplier.
                  </span>
                  <Link href="/procurement/reorder" className="shrink-0 font-medium text-primary hover:underline">
                    Review restocking →
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
