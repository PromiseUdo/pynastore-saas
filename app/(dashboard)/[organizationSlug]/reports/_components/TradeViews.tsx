'use client';

/*
 * Wholesale in Reports (ROADMAP 21.8): retail and trade side by side with
 * the top trade buyers, and money owed by how late it is. The figures come
 * from features/reports/trade-reports.ts; this only lays them out.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Building2, ShoppingBag, Users, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { AGE_BUCKETS } from '@/lib/reports/ageing';
import type { MoneyOwedReport, TradeReport } from '@/features/reports/trade-reports';

const pct = (ratio: number | null) => (ratio === null ? '—' : `${Math.round(ratio * 1000) / 10}%`);

export function TradeView({ report }: { report: TradeReport }) {
  const router = useRouter();
  return (
    <>
      <StatGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Wholesale sales" value={formatMoney(report.trade.sales)} icon={Building2} description={`${pct(report.tradeShareRatio)} of all sales`} />
        <StatCard title="Retail sales" value={formatMoney(report.retail.sales)} icon={ShoppingBag} description={`${formatNumber(report.retail.orders)} orders`} />
        <StatCard
          title="Average wholesale order"
          value={report.trade.averageOrder === null ? '—' : formatMoney(report.trade.averageOrder)}
          icon={Building2}
          description={report.retail.averageOrder === null ? undefined : `Retail: ${formatMoney(report.retail.averageOrder)}`}
        />
        <StatCard title="Wholesalers who ordered" value={formatNumber(report.tradeBuyers)} icon={Users} description={`${formatNumber(report.trade.orders)} wholesale orders`} />
      </StatGrid>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No wholesale orders in this period"
          description="Orders placed by your approved wholesalers show here. Make a customer a wholesaler from their page in Customers."
        />
      ) : (
        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader className="w-10">#</TableColumnHeader>
                <TableColumnHeader primary>Wholesaler</TableColumnHeader>
                <TableColumnHeader align="right">Orders</TableColumnHeader>
                <TableColumnHeader align="right">Spent</TableColumnHeader>
                <TableColumnHeader align="right">Owes you now</TableColumnHeader>
                <TableColumnHeader className="hidden sm:table-cell">Last order</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.rows.map((r, i) => (
                <TableRow key={r.customerId} clickable onClick={() => router.push(`/sales/customers/${r.customerId}`)}>
                  <TableCell muted className="tabular-nums">
                    {i + 1}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/sales/customers/${r.customerId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-foreground hover:underline"
                    >
                      {r.businessName}
                    </Link>
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {formatNumber(r.orders)}
                  </TableCell>
                  <TableCell align="right" className="font-medium tabular-nums">
                    {formatMoney(r.spend)}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {r.owed > 0 ? formatMoney(r.owed) : '—'}
                  </TableCell>
                  <TableCell muted className="hidden whitespace-nowrap sm:table-cell">
                    {formatDate(r.lastOrderAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      )}
    </>
  );
}

export function MoneyOwedView({ report }: { report: MoneyOwedReport }) {
  const router = useRouter();
  const late = report.totals.days31to60 + report.totals.over60;
  return (
    <>
      <StatGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="You’re owed" value={formatMoney(report.totals.owed)} icon={Wallet} description={`by ${formatNumber(report.customers)} customer${report.customers === 1 ? '' : 's'}`} />
        <StatCard title="Not due yet" value={formatMoney(report.totals.notDue)} icon={Wallet} />
        <StatCard title="Overdue" value={formatMoney(report.totals.overdue)} icon={AlertTriangle} description={`${formatMoney(report.totals.days1to30)} is 1–30 days late`} />
        <StatCard title="Over 30 days late" value={formatMoney(late)} icon={AlertTriangle} description={`${formatMoney(report.totals.over60)} is over 60 days`} />
      </StatGrid>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nobody owes you anything"
          description="Orders on a wholesaler’s account and invoices you’ve sent show here until they’re paid."
        />
      ) : (
        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader primary>Customer</TableColumnHeader>
                {AGE_BUCKETS.map((b) => (
                  <TableColumnHeader key={b.key} align="right" className={b.key === 'notDue' ? 'hidden md:table-cell' : undefined}>
                    {b.label}
                  </TableColumnHeader>
                ))}
                <TableColumnHeader align="right">Owed</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.customerId} clickable onClick={() => router.push(`/sales/customers/${r.customerId}`)}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/sales/customers/${r.customerId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-foreground hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.trade && <Badge variant="approved">Wholesale</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(r.items)} open · {r.oldestDueAt ? `oldest due ${formatDate(r.oldestDueAt)}` : 'no due date'} ·{' '}
                      <Link href={`/sales/customers/${r.customerId}/statement`} onClick={(e) => e.stopPropagation()} className="underline">
                        Statement
                      </Link>
                    </p>
                  </TableCell>
                  {AGE_BUCKETS.map((b) => (
                    <TableCell
                      key={b.key}
                      align="right"
                      className={`tabular-nums ${b.key === 'notDue' ? 'hidden md:table-cell' : ''} ${b.key !== 'notDue' && r.ages[b.key] > 0 ? 'text-destructive' : ''}`}
                    >
                      {r.ages[b.key] > 0 ? formatMoney(r.ages[b.key]) : '—'}
                    </TableCell>
                  ))}
                  <TableCell align="right" className="font-medium tabular-nums">
                    {formatMoney(r.owed)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      )}
    </>
  );
}
