'use client';

/*
 * "Which store sells" (ROADMAP 8.5), moved into the reports hub by 14.6. The
 * figures are features/sales/store-sales.ts; what they leave out is said
 * under the table (AGENTS §10).
 */
import Link from 'next/link';
import { Store, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { formatMoney, formatNumber } from '@/lib/format';
import type { StoreSalesReport } from '@/features/sales/store-sales';

export function StoreSalesView({ report, periodLabel }: { report: StoreSalesReport; periodLabel: string }) {
  return (
    <>
      <StatGrid className="sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Sold across every store"
          value={formatMoney(report.totals.goodsValue)}
          icon={Store}
          description={periodLabel}
        />
        <StatCard title="Orders" value={formatNumber(report.totals.orderCount)} icon={TrendingUp} description="not counting cancelled ones" />
        <StatCard title="Units sold" value={formatNumber(report.totals.unitsSold)} icon={Store} description="off every shelf" />
      </StatGrid>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No stores yet"
          description="Stock is counted per store, so add the places you keep goods and their sales will be compared here."
          action={
            <Link href="/inventory/warehouses" className="text-sm font-medium text-primary hover:underline">
              Go to stores
            </Link>
          }
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
                {report.rows.map((r) => (
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
                      {report.totals.goodsValue === 0 ? '—' : `${Math.round(r.shareRatio * 100)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>

          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              An order filled from two stores counts for both, each with its own share of the goods — so the store rows add up to the
              total above, while the order counts do not.
            </p>
            {report.unattributed.orderCount > 0 && (
              <p>
                {formatNumber(report.unattributed.orderCount)} order{report.unattributed.orderCount === 1 ? '' : 's'} worth{' '}
                {formatMoney(report.unattributed.goodsValue)} can&apos;t be credited to any store — nothing was held for them, or the hold
                was given back. They are missing from the rows above.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
