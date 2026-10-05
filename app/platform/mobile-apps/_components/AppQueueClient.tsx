'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatNumber, formatRelativeTime } from '@/lib/format';
import { appStateBadge } from '@/lib/mobile/labels';
import type { AppQueuePage, AppQueueTab } from '@/features/platform/mobile-apps';

const EMPTY: Record<AppQueueTab, string> = {
  TO_BUILD: 'When a merchant pays for their app, it appears here to be built.',
  DELIVERED: 'Apps handed to their merchants, waiting to be published.',
  LIVE: 'Apps listed in the App Store or Google Play.',
  UNPAID: 'Merchants who filled in their app’s details but haven’t paid.',
  SWITCHED_OFF: 'Apps that weren’t renewed, or that staff switched off.',
  ALL: 'Every store app.',
};

export function AppQueueClient({ data, tab }: { data: AppQueuePage; tab: AppQueueTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = new Date();

  const go = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    router.push(params.toString() ? `${pathname}?${params}` : pathname);
  };

  const tabs = [
    { key: 'TO_BUILD', label: `To build (${formatNumber(data.counts.TO_BUILD)})` },
    { key: 'DELIVERED', label: `Delivered (${formatNumber(data.counts.DELIVERED)})` },
    { key: 'LIVE', label: `Live (${formatNumber(data.counts.LIVE)})` },
    { key: 'UNPAID', label: `Not paid (${formatNumber(data.counts.UNPAID)})` },
    { key: 'SWITCHED_OFF', label: `Switched off (${formatNumber(data.counts.SWITCHED_OFF)})` },
    { key: 'ALL', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      <div className="border-b pb-2.5">
        <PageTabs tabs={tabs} current={tab} param="tab" />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState icon={Smartphone} title="Nothing here" description={EMPTY[tab]} />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>App</TableColumnHeader>
                  <TableColumnHeader>Phones</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader>Paid until</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((r) => {
                  const href = `/platform/mobile-apps/${r.id}`;
                  const badge = appStateBadge(r);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        router.push(href);
                      }}
                    >
                      <TableCell>
                        <Link href={href} className="font-medium text-foreground hover:underline">
                          {r.appName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{r.shopName}</span>
                      </TableCell>
                      <TableCell>{[r.platforms.android && 'Android', r.platforms.ios && 'iPhone'].filter(Boolean).join(', ')}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <span className="block text-xs text-muted-foreground" title={formatDate(r.since)}>
                          {r.stage === 'REQUESTED' ? 'asked' : 'paid'} {formatRelativeTime(r.since, now)}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{r.paidThrough ? formatDate(r.paidThrough) : '—'}</TableCell>
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
              onPageChange={go}
            />
          )}
        </>
      )}
    </div>
  );
}
