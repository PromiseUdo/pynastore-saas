'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Inbox, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { formatDate, formatNumber, formatRelativeTime } from '@/lib/format';
import { BUSINESS_TYPES } from '@/lib/payments/payment-setup';
import type { QueueFilter, QueuePage } from '@/features/platform/verification';
import { VERIFICATION_LABEL, VERIFICATION_VARIANT } from '../labels';

export function QueueClient({ data, status, q }: { data: QueuePage; status: QueueFilter; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState(q);
  const now = new Date();

  function go(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const tabs = [
    { key: 'PENDING', label: `Waiting (${formatNumber(data.counts.PENDING)})` },
    { key: 'REJECTED', label: `Sent back (${formatNumber(data.counts.REJECTED)})` },
    { key: 'VERIFIED', label: `Approved (${formatNumber(data.counts.VERIFIED)})` },
    { key: 'ALL', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b pb-2.5 sm:flex-row sm:items-end sm:justify-between">
        <PageTabs tabs={tabs} current={status} param="status" />
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: query.trim() || null, page: null });
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search businesses"
              placeholder="Business or web address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-64 pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>
      </div>

      {data.rows.length === 0 ? (
        q ? (
          <EmptyState
            variant="filtered"
            icon={Search}
            title="No business matches that search"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('');
                  go({ q: null, page: null });
                }}
              >
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title={status === 'PENDING' ? 'Nothing waiting for review' : 'Nothing here yet'}
            description={
              status === 'PENDING'
                ? 'When a business submits its details in Settings → Payments → Get paid online, it appears here.'
                : 'Businesses appear here once they have been reviewed.'
            }
          />
        )
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Business</TableColumnHeader>
                  <TableColumnHeader>Type</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader>{status === 'PENDING' ? 'Waiting since' : 'Decided'}</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((row) => {
                  const href = `/platform/verification/${row.organizationId}`;
                  const when = status === 'PENDING' ? row.submittedAt : (row.reviewedAt ?? row.submittedAt);
                  return (
                    <TableRow
                      key={row.organizationId}
                      className="cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        router.push(href);
                      }}
                    >
                      <TableCell>
                        <Link href={href} className="font-medium text-foreground hover:underline">
                          {row.businessName ?? row.organizationName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{row.organizationSlug}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {BUSINESS_TYPES.find((t) => t.value === row.businessType)?.label ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={VERIFICATION_VARIANT[row.verificationStatus]}>
                          {VERIFICATION_LABEL[row.verificationStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {when ? <span title={formatDate(when)}>{formatRelativeTime(when, now)}</span> : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableWrapper>
          {data.total > data.pageSize && (
            <TablePagination
              page={data.page}
              totalPages={Math.ceil(data.total / data.pageSize)}
              totalItems={data.total}
              pageSize={data.pageSize}
              onPageChange={(page) => go({ page: page > 1 ? String(page) : null })}
            />
          )}
        </>
      )}
    </div>
  );
}
