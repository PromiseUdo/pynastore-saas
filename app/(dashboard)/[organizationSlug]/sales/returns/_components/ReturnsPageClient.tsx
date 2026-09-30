'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageBody, PageHeader, PageToolbar } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { ReturnsFilter, ReturnsPage, SourceFilter } from '@/features/sales/work-lists';

const SOURCE_LABEL: Record<SourceFilter, string> = { all: 'Orders and invoices', order: 'Online store only', invoice: 'Invoices only' };

export function ReturnsPageClient({
  data,
  filter,
  source,
  q,
}: {
  data: ReturnsPage;
  filter: ReturnsFilter;
  source: SourceFilter;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('view');
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
    { key: 'open', label: `Waiting on you (${formatNumber(data.counts.open)})` },
    { key: 'all', label: 'All returns' },
  ];
  const filtering = source !== 'all' || q.length > 0;

  return (
    <>
      <PageHeader
        title="Returns"
        description="Items customers are sending back — from your online store and against invoices — and the refunds you’ve recorded."
      />
      <PageToolbar className="gap-y-2">
        <PageTabs tabs={tabs} current={filter} param="status" />
      </PageToolbar>
      <PageToolbar>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search returns"
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
      </PageToolbar>
      <PageBody>
        {data.rows.length === 0 ? (
          filtering ? (
            <EmptyState
              variant="filtered"
              icon={Search}
              title="No returns match"
              action={
                <Button variant="outline" size="sm" onClick={() => setParams({ q: null, source: null })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={RotateCcw}
              title={filter === 'open' ? 'Nothing waiting on you' : 'No returns yet'}
              description="Online-store customers ask to return items from their account; returns against an invoice are raised from the invoice. Both appear here."
            />
          )
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Return for</TableColumnHeader>
                    <TableColumnHeader>Reason</TableColumnHeader>
                    <TableColumnHeader align="right">Items</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader align="right">Refunded</TableColumnHeader>
                    <TableColumnHeader>Asked</TableColumnHeader>
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
                          <Badge variant={r.source === 'order' ? 'info' : 'muted'}>{r.source === 'order' ? 'Online store' : 'Invoice'}</Badge>
                        </div>
                        <span className="block text-xs text-muted-foreground">{r.customerName}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.reason ?? '—'}</TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatNumber(r.itemCount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.statusVariant}>{r.statusLabel}</Badge>
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {r.refunded === null ? '—' : formatMoney(r.refunded, r.currency)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.requestedAt)}</TableCell>
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
