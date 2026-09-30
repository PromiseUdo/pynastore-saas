'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bug, CheckCircle2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageBody, PageToolbar } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatNumber, formatRelativeTime } from '@/lib/format';
import type { ErrorSourceFilter, ErrorStatusFilter, ErrorsPage } from '@/features/platform/errors';
import { kindLabel, SOURCE_LABEL } from '../labels';

const SOURCE_FILTER_LABEL: Record<ErrorSourceFilter, string> = {
  all: 'Every source',
  server: 'Server only',
  client: 'Browsers only',
  webhook: 'Webhooks only',
};

const DAY = 86_400_000;

export function ErrorsClient({
  data,
  status,
  source,
  q,
}: {
  data: ErrorsPage;
  status: ErrorStatusFilter;
  source: ErrorSourceFilter;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

  const filtering = source !== 'all' || q.length > 0;
  const now = Date.now();

  return (
    <>
      <PageToolbar className="gap-y-2">
        <PageTabs
          tabs={[
            { key: 'open', label: `Open (${formatNumber(data.counts.open)})` },
            { key: 'resolved', label: 'Resolved' },
            { key: 'all', label: 'All' },
          ]}
          current={status}
          param="status"
        />
      </PageToolbar>
      <PageToolbar>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search errors"
            placeholder="Message or where it happened"
            defaultValue={q}
            onChange={(e) => setParams({ q: e.target.value })}
            className="pl-8"
          />
        </div>
        <SelectRoot value={source} onValueChange={(v) => setParams({ source: v === 'all' ? null : v })}>
          <SelectTrigger aria-label="Show" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SOURCE_FILTER_LABEL) as ErrorSourceFilter[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SOURCE_FILTER_LABEL[k]}
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
              title="No errors match"
              action={
                <Button variant="outline" size="sm" onClick={() => setParams({ q: null, source: null })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={status === 'open' ? CheckCircle2 : Bug}
              title={status === 'open' ? 'No open errors' : status === 'resolved' ? 'Nothing resolved yet' : 'No errors recorded'}
              description="Server errors, errors in people’s browsers and webhook failures are recorded here on the live site, grouped so the same problem appears once."
            />
          )
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Error</TableColumnHeader>
                    <TableColumnHeader>Source</TableColumnHeader>
                    <TableColumnHeader align="right">Last 24 hours</TableColumnHeader>
                    <TableColumnHeader align="right">In all</TableColumnHeader>
                    <TableColumnHeader>Last seen</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.map((row) => {
                    const href = `/platform/errors/${row.id}`;
                    const isNew = now - new Date(row.firstSeenAt).getTime() < DAY;
                    return (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('a')) return;
                          router.push(href);
                        }}
                      >
                        <TableCell className="max-w-xl">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Link href={href} className="truncate font-medium text-foreground hover:underline" title={row.message}>
                                {row.message}
                              </Link>
                              {isNew && !row.resolved && <Badge variant="warning">New</Badge>}
                              {row.resolved && <Badge variant="success">Resolved</Badge>}
                            </div>
                            <span className="truncate font-mono text-xs text-muted-foreground" title={row.where}>
                              {row.where}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell muted>
                          <div className="flex flex-col">
                            <span>{SOURCE_LABEL[row.source]}</span>
                            <span className="text-xs">{kindLabel(row.kind)}</span>
                          </div>
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {row.last24h ? formatNumber(row.last24h) : '—'}
                        </TableCell>
                        <TableCell align="right" muted className="tabular-nums">
                          {formatNumber(row.count)}
                        </TableCell>
                        <TableCell muted>{formatRelativeTime(row.lastSeenAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableWrapper>
            <TablePagination
              className="mt-4"
              page={data.page}
              totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))}
              totalItems={data.total}
              pageSize={data.pageSize}
              onPageChange={(p) => setParams({ page: p > 1 ? String(p) : null })}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
