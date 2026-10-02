'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatNumber, formatRelativeTime } from '@/lib/format';
import { PROMISE_HOURS } from '@/lib/domains/rules';
import { setNamecheapBalance, type DomainQueuePage, type QueueTab } from '@/features/platform/domains';
import { ORDER_KIND_LABEL, ORDER_STATUS } from '../labels';

function timeLeft(readyAt: Date, now: Date): { label: string; overdue: boolean } {
  const ms = new Date(readyAt).getTime() + PROMISE_HOURS * 3600_000 - now.getTime();
  const hours = Math.round(Math.abs(ms) / 3600_000);
  if (ms < 0) return { label: `${hours || 1}h overdue`, overdue: true };
  return { label: hours ? `${hours}h left` : 'under 1h left', overdue: false };
}

export function DomainQueueClient({ data, tab }: { data: DomainQueuePage; tab: QueueTab }) {
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
    { key: 'WAITING', label: `Waiting (${formatNumber(data.counts.WAITING)})` },
    { key: 'DONE', label: `Done (${formatNumber(data.counts.DONE)})` },
    { key: 'FAILED', label: `Failed (${formatNumber(data.counts.FAILED)})` },
    { key: 'ALL', label: 'All' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Renewals renewals={data.renewals} now={now} />
        <Balance live={data.liveBalance} manual={data.namecheapBalance} waitingCost={data.waitingCost} />
      </div>

      <div className="space-y-4">
        <div className="border-b pb-2.5">
          <PageTabs tabs={tabs} current={tab} param="tab" />
        </div>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={tab === 'WAITING' ? 'Nothing waiting' : 'Nothing here yet'}
            description={
              tab === 'WAITING'
                ? 'When a merchant pays for a domain, renews one, or connects their own and its records are right, it appears here.'
                : 'Finished domain work appears here.'
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Domain</TableColumnHeader>
                    <TableColumnHeader>Work</TableColumnHeader>
                    <TableColumnHeader>Checklist</TableColumnHeader>
                    <TableColumnHeader>{tab === 'WAITING' ? 'Against 24 hours' : 'Status'}</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.map((r) => {
                    const href = `/platform/domains/${r.id}`;
                    const left = timeLeft(r.readyAt, now);
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
                            {r.domain ?? '—'}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{r.shopName}</span>
                        </TableCell>
                        <TableCell>{ORDER_KIND_LABEL[r.type]}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {r.stepsDone} of {r.stepsTotal}
                        </TableCell>
                        <TableCell>
                          {r.status === 'PENDING_FULFILLMENT' ? (
                            <Badge variant={left.overdue ? 'overdue' : 'pending'}>{left.label}</Badge>
                          ) : (
                            <Badge variant={ORDER_STATUS[r.status]?.variant ?? 'draft'}>{ORDER_STATUS[r.status]?.label ?? '—'}</Badge>
                          )}
                          <span className="block text-xs text-muted-foreground" title={formatDate(r.readyAt)}>
                            since {formatRelativeTime(r.readyAt, now)}
                          </span>
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
                onPageChange={go}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Renewals({ renewals, now }: { renewals: DomainQueuePage['renewals']; now: Date }) {
  return (
    <section aria-labelledby="renewals-title" className="rounded-lg border bg-card shadow-xs lg:col-span-2">
      <div className="border-b px-5 py-3.5">
        <h2 id="renewals-title" className="text-sm font-semibold text-foreground">
          Renewals due
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Registered domains expiring within 14 days, or expired but still renewable.</p>
      </div>
      {renewals.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">None due.</p>
      ) : (
        <ul className="divide-y">
          {renewals.map((r) => (
            <li key={r.domain} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <span>
                <span className="font-medium text-foreground">{r.domain}</span>
                <span className="text-xs text-muted-foreground"> · {r.shopName}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground" title={formatDate(r.expiresAt)}>
                  {new Date(r.expiresAt) < now ? 'expired' : 'expires'} {formatRelativeTime(r.expiresAt, now)}
                </span>
                <Badge variant={r.renewalPaid ? 'warning' : 'muted'}>{r.renewalPaid ? 'Paid — renew at Namecheap' : 'Not renewed by merchant'}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The Namecheap account, read live, against what the waiting work will
 * spend there. When Namecheap can't be reached, the last figure staff typed
 * in stands in, with its age and the reason.
 */
function Balance({
  live,
  manual,
  waitingCost,
}: {
  live: DomainQueuePage['liveBalance'];
  manual: DomainQueuePage['namecheapBalance'];
  waitingCost: DomainQueuePage['waitingCost'];
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(manual ? String(manual.usd) : '');
  const [pending, setPending] = React.useState(false);
  const now = new Date();
  const isLive = !('error' in live);
  const available = isLive ? live.availableUsd : (manual?.usd ?? null);
  const short = available !== null && waitingCost.usd > available ? waitingCost.usd - available : 0;

  return (
    <section aria-labelledby="balance-title" className="space-y-3 rounded-lg border bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="balance-title" className="text-sm font-semibold text-foreground">
            Namecheap balance
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Registrations and renewals are paid from it.</p>
        </div>
        {isLive && <Badge variant="success">Live</Badge>}
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Available</dt>
          <dd className="font-semibold tabular-nums text-foreground">{available !== null ? usd(available) : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            Waiting work ({waitingCost.orders} to register or renew)
          </dt>
          <dd className="tabular-nums text-foreground">{usd(waitingCost.usd)}</dd>
        </div>
      </dl>

      {short > 0 ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          Not enough to do the waiting work. Top up at least {usd(Math.ceil(short))} before starting.
        </p>
      ) : available !== null && waitingCost.orders > 0 ? (
        <p className="text-xs text-muted-foreground">Enough for the waiting work, with {usd(available - waitingCost.usd)} to spare.</p>
      ) : null}

      {isLive ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Read from Namecheap {formatRelativeTime(live.fetchedAt, now)}.</span>
          <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
            Refresh
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Couldn’t read it from Namecheap: {live.error}
            {manual ? ` Showing what was entered ${formatRelativeTime(manual.updatedAt, now)}.` : ''}
          </p>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              const r = await setNamecheapBalance(Number(value));
              setPending(false);
              if (!r.success) return toast.error(r.error);
              toast.success('Balance saved');
              router.refresh();
            }}
          >
            <Input
              aria-label="Balance in US dollars, as Namecheap shows it"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              startAdornment={<span className="text-sm text-muted-foreground">$</span>}
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
