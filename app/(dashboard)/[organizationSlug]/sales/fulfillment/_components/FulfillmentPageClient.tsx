'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PackageCheck, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageBody, PageHeader, PageToolbar } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatNumber, formatRelativeTime } from '@/lib/format';
import type { SourceFilter, ToSendFilter, ToSendPage } from '@/features/sales/work-lists';

const SOURCE_LABEL: Record<SourceFilter, string> = { all: 'Orders and invoices', order: 'Orders only', invoice: 'Invoices only' };

export function FulfillmentPageClient({
  data,
  filter,
  source,
  q,
}: {
  data: ToSendPage;
  filter: ToSendFilter;
  source: SourceFilter;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = new Date();

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const tabs = [
    { key: 'open', label: `To send (${formatNumber(data.counts.open)})` },
    { key: 'done', label: 'Sent' },
    { key: 'all', label: 'All' },
  ];
  const filtering = source !== 'all' || q.length > 0;

  return (
    <>
      <PageHeader
        title="Fulfillment"
        description="Everything waiting to go out — online order parcels and invoices — oldest first. Each opens where you send it."
      />
      <PageToolbar className="gap-y-2">
        <PageTabs tabs={tabs} current={filter} param="status" />
      </PageToolbar>
      <PageToolbar>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search"
            placeholder="Order, invoice or customer"
            defaultValue={q}
            onChange={(e) => setParams({ q: e.target.value })}
            className="pl-8"
          />
        </div>
        <SelectRoot value={source} onValueChange={(v) => setParams({ source: v === 'all' ? null : v })}>
          <SelectTrigger aria-label="Show" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SOURCE_LABEL) as SourceFilter[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SOURCE_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        {filter === 'open' && data.counts.open > 0 && (
          <p className="text-xs text-muted-foreground sm:ml-auto">
            {formatNumber(data.counts.openOrders)} online {data.counts.openOrders === 1 ? 'parcel' : 'parcels'} ·{' '}
            {formatNumber(data.counts.openInvoices)} {data.counts.openInvoices === 1 ? 'invoice' : 'invoices'}
          </p>
        )}
      </PageToolbar>
      <PageBody>
        {data.rows.length === 0 ? (
          filtering ? (
            <EmptyState
              variant="filtered"
              icon={Search}
              title="Nothing matches"
              action={
                <Button variant="outline" size="sm" onClick={() => setParams({ q: null, source: null })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={PackageCheck}
              title={filter === 'open' ? 'Nothing to send' : 'Nothing here yet'}
              description={
                filter === 'open'
                  ? 'Paid and pay-on-delivery online orders appear here when they’re ready to go out, and so do invoices you’re dispatching.'
                  : 'Parcels and invoices you’ve sent appear here.'
              }
            />
          )
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>For</TableColumnHeader>
                    <TableColumnHeader>From</TableColumnHeader>
                    <TableColumnHeader align="right">Items</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader>{filter === 'open' ? 'Waiting' : 'When'}</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow
                      key={r.key}
                      className="cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        router.push(r.href);
                      }}
                    >
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={r.href} className="font-medium text-foreground hover:underline">
                            {r.reference}
                          </Link>
                          <Badge variant={r.source === 'order' ? 'info' : 'muted'}>{r.source === 'order' ? 'Online order' : 'Invoice'}</Badge>
                        </div>
                        <span className="block text-xs text-muted-foreground">
                          {r.customerName}
                          {r.payOnDelivery ? ' · pay on delivery' : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.storeName ?? '—'}
                        <span className="block text-xs text-muted-foreground">{r.kindLabel}</span>
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatNumber(r.itemCount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.statusVariant}>{r.statusLabel}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDate(r.since)}>
                        {formatRelativeTime(r.since, now)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
            {data.total > data.pageSize && (
              <TablePagination
                page={data.page}
                totalPages={Math.ceil(data.total / data.pageSize)}
                totalItems={data.total}
                pageSize={data.pageSize}
                onPageChange={(p) => setParams({ page: p > 1 ? String(p) : null })}
              />
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
