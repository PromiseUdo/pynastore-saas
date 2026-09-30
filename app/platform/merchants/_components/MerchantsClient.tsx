'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { MerchantPage, MerchantPlanFilter, MerchantStatusFilter } from '@/features/platform/merchants';
import { VERIFICATION_LABEL, VERIFICATION_VARIANT } from '../../verification/labels';
import { PLAN_STATE_LABEL, PLAN_STATE_ORDER, PLAN_STATE_VARIANT } from '../labels';

export function MerchantsClient({
  data,
  status,
  plan,
  q,
}: {
  data: MerchantPage;
  status: MerchantStatusFilter;
  plan: MerchantPlanFilter;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState(q);

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
    { key: 'all', label: `All (${formatNumber(data.counts.all)})` },
    { key: 'active', label: `Active (${formatNumber(data.counts.active)})` },
    { key: 'suspended', label: `Suspended (${formatNumber(data.counts.suspended)})` },
  ];
  const filtered = Boolean(q) || plan !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b lg:flex-row lg:items-end lg:justify-between">
        <PageTabs tabs={tabs} current={status} param="status" />
        <div className="flex flex-wrap items-center gap-2 pb-2.5">
          <SelectRoot value={plan} onValueChange={(v) => go({ plan: v === 'all' ? null : v, page: null })}>
            <SelectTrigger aria-label="Plan" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any plan state</SelectItem>
              {PLAN_STATE_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {PLAN_STATE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
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
                aria-label="Search merchants"
                placeholder="Name, web address or email"
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
      </div>

      <p className="text-xs text-muted-foreground">
        Orders count this month’s orders from every channel, less cancelled ones. Online takings are payments customers
        completed online this month, before Paystack’s fee — counter and pay-on-delivery sales aren’t in it.
      </p>

      {data.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            variant="filtered"
            icon={Search}
            title="No merchant matches these filters"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('');
                  go({ q: null, plan: null, page: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Building2}
            title={status === 'suspended' ? 'No suspended workspaces' : 'No merchants yet'}
            description={
              status === 'suspended'
                ? 'Workspaces you suspend appear here, so you can find them to restore.'
                : 'A merchant appears here as soon as they create a workspace.'
            }
          />
        )
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Merchant</TableColumnHeader>
                  <TableColumnHeader>Plan</TableColumnHeader>
                  <TableColumnHeader>Shop setup</TableColumnHeader>
                  <TableColumnHeader>Online payments</TableColumnHeader>
                  <TableColumnHeader align="right">Stores</TableColumnHeader>
                  <TableColumnHeader align="right">Orders this month</TableColumnHeader>
                  <TableColumnHeader align="right">Online takings this month</TableColumnHeader>
                  <TableColumnHeader>Joined</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((row) => {
                  const href = `/platform/merchants/${row.id}`;
                  return (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        router.push(href);
                      }}
                    >
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={href} className="font-medium text-foreground hover:underline">
                            {row.name}
                          </Link>
                          {row.status === 'SUSPENDED' && <Badge variant="destructive">Suspended</Badge>}
                        </div>
                        <span className="block text-xs text-muted-foreground">
                          {row.slug}
                          {row.ownerEmail ? ` · ${row.ownerEmail}` : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={PLAN_STATE_VARIANT[row.planState]}>{PLAN_STATE_LABEL[row.planState]}</Badge>
                        <span className="block text-xs text-muted-foreground">{row.planName ?? '—'}</span>
                      </TableCell>
                      <TableCell>
                        {row.setup.isOpen ? (
                          <Badge variant="success">Open</Badge>
                        ) : (
                          <Badge variant="muted">
                            Not open · {row.setup.requiredDone} of {row.setup.requiredTotal}
                          </Badge>
                        )}
                        {!row.setup.isOpen && row.setup.next && (
                          <span className="block max-w-48 truncate text-xs text-muted-foreground" title={row.setup.next}>
                            Next: {row.setup.next}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={VERIFICATION_VARIANT[row.verificationStatus]}>
                          {VERIFICATION_LABEL[row.verificationStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatNumber(row.stores)}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatNumber(row.ordersThisMonth)}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatMoney(row.takingsThisMonth)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
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
