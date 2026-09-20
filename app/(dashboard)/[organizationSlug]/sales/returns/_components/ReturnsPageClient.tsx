'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { enumLabel, formatDate, formatMoney, formatNumber } from '@/lib/format';
import { ORDER_RETURN_LABEL, ORDER_RETURN_VARIANT } from '@/lib/sales/order-labels';
import type { ReturnListRow } from '@/features/sales/actions';
import type { OrderReturnFilter, OrderReturnListRow } from '@/features/sales/order-returns';

const TABS = [
  { key: 'online', label: 'Online store' },
  { key: 'invoices', label: 'Invoices' },
];

const FILTER_LABEL: Record<OrderReturnFilter, string> = {
  open: 'Waiting on you',
  all: 'All returns',
  REQUESTED: 'New requests',
  APPROVED: 'Approved, not refunded',
  REFUNDED: 'Refunded',
  REJECTED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

const INVOICE_STATUS_VARIANT: Record<ReturnListRow['status'], 'pending' | 'approved' | 'rejected'> = {
  REQUESTED: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

type Props =
  | { view: 'invoices'; invoiceReturns: ReturnListRow[] }
  | {
      view: 'online';
      online: { rows: OrderReturnListRow[]; total: number; page: number; pageSize: number; openCount: number };
      filter: OrderReturnFilter;
      query: string;
    };

export function ReturnsPageClient(props: Props) {
  return (
    <>
      <PageHeader
        title="Returns"
        description="Items customers are sending back, and the refunds you’ve recorded for them."
      />
      <PageToolbar className="gap-y-2">
        <PageTabs tabs={TABS} current={props.view} />
      </PageToolbar>
      {props.view === 'online' ? (
        <OnlineReturns online={props.online} filter={props.filter} query={props.query} />
      ) : (
        <InvoiceReturns returns={props.invoiceReturns} />
      )}
    </>
  );
}

function OnlineReturns({
  online,
  filter,
  query,
}: {
  online: { rows: OrderReturnListRow[]; total: number; page: number; pageSize: number; openCount: number };
  filter: OrderReturnFilter;
  query: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const filtering = filter !== 'open' || query.trim().length > 0;
  const totalPages = Math.max(1, Math.ceil(online.total / online.pageSize));

  return (
    <>
      <PageToolbar>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search returns"
            placeholder="Order number or customer"
            defaultValue={query}
            onChange={(e) => setParams({ q: e.target.value })}
            className="pl-8"
          />
        </div>
        <SelectRoot value={filter} onValueChange={(value) => setParams({ status: value === 'open' ? null : value })}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FILTER_LABEL) as OrderReturnFilter[]).map((key) => (
              <SelectItem key={key} value={key}>
                {FILTER_LABEL[key]}
                {key === 'open' && online.openCount > 0 ? ` (${formatNumber(online.openCount, 0)})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
      </PageToolbar>

      <PageBody>
        <p className="mb-4 text-sm text-muted-foreground">
          Customers ask for a return from their account, within the return window you set in{' '}
          <Link href="/settings/delivery#returns" className="font-medium text-foreground underline-offset-2 hover:underline">
            Settings → Delivery and returns
          </Link>
          . Open a return’s order to approve it, decline it or record the refund.
        </p>

        {online.rows.length === 0 ? (
          filtering ? (
            <EmptyState
              variant="filtered"
              title="No returns match"
              description={
                filter === 'open' ? 'Nothing waiting on you matches that search.' : 'Nothing here fits that search or filter.'
              }
              action={
                <Button size="sm" variant="outline" onClick={() => setParams({ q: null, status: null })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={RotateCcw}
              title="Nothing waiting on you"
              description="When a customer asks to send items back, the request shows up here and you’re emailed."
              action={
                <Button size="sm" variant="outline" onClick={() => setParams({ status: 'all' })}>
                  See all returns
                </Button>
              }
            />
          )
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Order</TableColumnHeader>
                    <TableColumnHeader>Customer</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader>Reason</TableColumnHeader>
                    <TableColumnHeader align="right">Items</TableColumnHeader>
                    <TableColumnHeader align="right">Refunded</TableColumnHeader>
                    <TableColumnHeader>Requested</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {online.rows.map((row) => (
                    <TableRow key={row.id} clickable onClick={() => router.push(`/sales/orders/${row.orderId}#returns`)}>
                      <TableCell className="font-medium text-foreground">
                        <Link
                          href={`/sales/orders/${row.orderId}#returns`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TableCell>
                      <TableCell muted>{row.customerName}</TableCell>
                      <TableCell>
                        <Badge variant={ORDER_RETURN_VARIANT[row.status] ?? 'draft'}>
                          {ORDER_RETURN_LABEL[row.status] ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell muted>{row.reasonLabel}</TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatNumber(row.itemCount, 0)}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {row.refunded === null ? '—' : formatMoney(row.refunded, row.currency)}
                      </TableCell>
                      <TableCell muted>{formatDate(row.requestedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
            {online.total > online.pageSize && (
              <TablePagination
                page={online.page}
                totalPages={totalPages}
                totalItems={online.total}
                pageSize={online.pageSize}
                onPageChange={(next) => setParams({ page: String(next) })}
              />
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

function InvoiceReturns({ returns }: { returns: ReturnListRow[] }) {
  const router = useRouter();

  return (
    <PageBody>
      {returns.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title="No invoice returns yet"
          description="Returns raised from an invoice show up here, ready to approve and restock."
        />
      ) : (
        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader>Invoice</TableColumnHeader>
                <TableColumnHeader>Customer</TableColumnHeader>
                <TableColumnHeader>Status</TableColumnHeader>
                <TableColumnHeader align="right">Line items</TableColumnHeader>
                <TableColumnHeader>Requested</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {returns.map((r) => (
                <TableRow key={r.id} clickable onClick={() => router.push(`/sales/returns/${r.id}`)}>
                  <TableCell className="font-medium text-foreground">
                    <Link href={`/sales/returns/${r.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                      {r.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell muted>{r.customerName}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_VARIANT[r.status]}>{enumLabel(r.status)}</Badge>
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {r.itemCount}
                  </TableCell>
                  <TableCell muted>{formatDate(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      )}
    </PageBody>
  );
}
