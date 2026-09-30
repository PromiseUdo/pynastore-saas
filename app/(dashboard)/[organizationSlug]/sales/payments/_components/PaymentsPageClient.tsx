'use client';

/*
 * The payments list (ROADMAP 10.6). Every figure is Paystack's own, from the
 * verified transaction; the page says so, says where the money goes, and says
 * what it can't tell the merchant (when each payment reached their bank)
 * rather than guessing (AGENTS §10).
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CreditCard, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { ExportCsvButton } from '@/components/dashboard/export-csv-button';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { DISPUTE_STATUS_VARIANT, disputeLabel } from '@/lib/sales/dispute-labels';
import { PAYMENT_METHOD_LABEL } from '@/lib/sales/order-labels';
import type { CsvColumn } from '@/lib/csv';
import { exportOnlinePayments, type PaymentList, type PaymentRow } from '@/features/sales/payments';
import { PLATFORM_NAME } from '@/lib/brand';

const RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
] as const;

const dash = (value: number | null, currency: string) => (value === null ? '—' : formatMoney(value, currency));

export function PaymentsPageClient({ list, canSetUp }: { list: PaymentList; canSetUp: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = React.useState(urlQuery);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        // The defaults stay out of the URL: 30 days, every payment.
        if (value === null || value === '' || (key === 'range' && value === '30d') || (key === 'view' && value === 'all')) {
          next.delete(key);
        } else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => setParams({ q: query }), 350);
    return () => clearTimeout(timer);
  }, [query, urlQuery, setParams]);

  const filtered = list.range !== '30d' || list.view !== 'all' || urlQuery !== '';
  const clear = () => {
    setQuery('');
    setParams({ q: null, range: null, view: null });
  };

  const columns: CsvColumn<PaymentRow>[] = [
    { header: 'Paid', value: (r) => formatDate(r.paidAt) },
    { header: 'Order', value: (r) => r.orderReference },
    { header: 'Customer', value: (r) => r.customerName },
    { header: 'Customer paid', value: (r) => r.amount },
    { header: 'Paystack fee', value: (r) => r.feeAmount },
    { header: 'You receive', value: (r) => r.merchantAmount },
    { header: 'Refunded', value: (r) => r.refunded || null },
    { header: 'Chargeback', value: (r) => (r.disputeStatus ? disputeLabel(r.disputeStatus) : null) },
    { header: 'Paid through', value: (r) => PAYMENT_METHOD_LABEL[r.provider] ?? r.provider },
    { header: 'Paystack reference', value: (r) => r.providerReference },
    { header: 'Currency', value: (r) => r.currency },
  ];

  const header = (
    <PageHeader
      title="Payments"
      description="What customers paid online, Paystack’s fee, and what reaches your bank."
      actions={
        list.historySize > 0 ? (
          <ExportCsvButton
            name="Online payments"
            columns={columns}
            fetchRows={() => exportOnlinePayments({ range: list.range, view: list.view, q: urlQuery })}
          />
        ) : undefined
      }
    />
  );

  const whereMoneyGoes = list.settlement
    ? `Paystack pays it into ${list.settlement.bankName ?? 'your bank'} ${list.settlement.accountNumber}${
        list.settlement.accountName ? ` (${list.settlement.accountName})` : ''
      } on its own schedule`
    : 'Paystack pays it into your bank account once online payments are set up';

  if (list.historySize === 0) {
    return (
      <>
        {header}
        <PageBody>
          <EmptyState
            icon={CreditCard}
            title="No online payments yet"
            description={
              list.settlement
                ? 'When a customer pays for an order online, the payment and what you receive from it appear here.'
                : 'Customers can pay online once your business is approved and payouts are set up.'
            }
            action={
              !list.settlement && canSetUp ? (
                <Button asChild size="sm">
                  <Link href="/settings/payments/online">Set up online payments</Link>
                </Button>
              ) : undefined
            }
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      {header}

      <PageToolbar>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order, customer or Paystack reference"
            className="pl-8"
            aria-label="Search payments"
          />
        </div>
        <SelectRoot value={list.range} onValueChange={(value) => setParams({ range: value })}>
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <SelectRoot value={list.view} onValueChange={(value) => setParams({ view: value })}>
          <SelectTrigger className="w-44" aria-label="Which payments">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every payment</SelectItem>
            <SelectItem value="disputed">With a chargeback</SelectItem>
          </SelectContent>
        </SelectRoot>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        )}
      </PageToolbar>

      <PageBody className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Amounts are as Paystack reported them for each payment. {whereMoneyGoes}. {PLATFORM_NAME} doesn’t hold your money or take
          a cut of your sales — the only deduction is Paystack’s fee. This page can’t show when each payment reached your
          bank; your bank statement can.
        </p>

        <StatGrid>
          <StatCard
            title="Customers paid"
            value={formatMoney(list.totals.paid, list.currency)}
            description={`${formatNumber(list.totals.count)} payment${list.totals.count === 1 ? '' : 's'}`}
          />
          <StatCard title="Paystack fees" value={formatMoney(list.totals.fees, list.currency)} description="Paid by you, per payment" />
          <StatCard
            title="You receive"
            value={formatMoney(list.totals.received, list.currency)}
            description="Before any refunds you send back"
          />
        </StatGrid>

        {list.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            icon={CreditCard}
            title="No payments match"
            description="Try a longer period or a different search, or clear the filters."
            action={
              <Button variant="outline" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Paid</TableColumnHeader>
                  <TableColumnHeader>Order</TableColumnHeader>
                  <TableColumnHeader align="right">Customer paid</TableColumnHeader>
                  <TableColumnHeader align="right">Paystack fee</TableColumnHeader>
                  <TableColumnHeader align="right">You receive</TableColumnHeader>
                  <TableColumnHeader>Paystack reference</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.rows.map((row) => (
                  <TableRow key={row.id} onClick={() => router.push(`/sales/orders/${row.orderId}`)} className="cursor-pointer">
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.paidAt)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/sales/orders/${row.orderId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-medium tabular-nums text-foreground hover:underline"
                      >
                        {row.orderReference}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {row.customerName ?? '—'}
                        {row.disputeStatus && (
                          <Badge variant={DISPUTE_STATUS_VARIANT[row.disputeStatus] ?? 'processing'}>
                            Chargeback: {disputeLabel(row.disputeStatus)}
                          </Badge>
                        )}
                        {row.refunded > 0 && (
                          <Badge variant="warning">Refunded {formatMoney(row.refunded, row.currency)}</Badge>
                        )}
                        {row.provider !== 'paystack' && <Badge variant="draft">{PAYMENT_METHOD_LABEL[row.provider] ?? row.provider}</Badge>}
                      </span>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {formatMoney(row.amount, row.currency)}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums text-muted-foreground">
                      {dash(row.feeAmount, row.currency)}
                    </TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">
                      {dash(row.merchantAmount, row.currency)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.providerReference ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {list.pageCount > 1 && (
              <TablePagination
                page={list.page}
                totalPages={list.pageCount}
                totalItems={list.total}
                pageSize={list.perPage}
                onPageChange={(next) => setParams({ page: String(next) })}
              />
            )}
          </TableWrapper>
        )}
      </PageBody>
    </>
  );
}
