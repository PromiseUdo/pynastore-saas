'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageBody } from '@/components/layout/page-header';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatNumber, formatRelativeTime } from '@/lib/format';
import { reopenError, resolveError, type ErrorDetail } from '@/features/platform/errors';
import { kindLabel, SOURCE_LABEL } from '../../labels';

export function ErrorDetailClient({ detail }: { detail: ErrorDetail }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    startTransition(async () => {
      const result = detail.resolved ? await reopenError(detail.id) : await resolveError(detail.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(detail.resolved ? 'Reopened' : 'Marked resolved — it will reopen if it happens again');
      router.refresh();
    });
  }

  const facts: [string, React.ReactNode][] = [
    ['Source', `${SOURCE_LABEL[detail.source]} · ${kindLabel(detail.kind)}`],
    ['Where', <span key="w" className="break-all font-mono text-xs">{detail.where}</span>],
    ['First seen', `${formatRelativeTime(detail.firstSeenAt)} (${formatDate(detail.firstSeenAt)})`],
    ['Last seen', formatRelativeTime(detail.lastSeenAt)],
    ['Last page', detail.lastPath ? <span key="p" className="break-all font-mono text-xs">{detail.lastPath}</span> : '—'],
  ];
  if (detail.lastDigest) {
    facts.push([
      'Digest',
      <span key="d">
        <span className="font-mono text-xs">{detail.lastDigest}</span>
        <span className="block text-xs text-muted-foreground">Search the host’s logs for this to find the full server log.</span>
      </span>,
    ]);
  }
  if (detail.resolved) {
    facts.push(['Resolved', `${detail.resolvedAt ? formatRelativeTime(detail.resolvedAt) : '—'}${detail.resolvedBy ? ` by ${detail.resolvedBy}` : ''}`]);
  }

  return (
    <div>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link href="/platform/errors" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" aria-hidden /> Errors
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={detail.resolved ? 'success' : 'destructive'}>{detail.resolved ? 'Resolved' : 'Open'}</Badge>
              <Badge variant="muted">{SOURCE_LABEL[detail.source]}</Badge>
            </div>
            <h1 className="break-words text-lg font-semibold tracking-tight text-foreground">{detail.message}</h1>
            <p className="text-sm text-muted-foreground">
              {detail.resolved
                ? 'Marked resolved. If it happens again it reopens, and staff are emailed.'
                : 'Mark it resolved once it’s fixed, or if it isn’t worth fixing. It reopens if it happens again.'}
            </p>
          </div>
          <Button size="sm" variant={detail.resolved ? 'outline' : 'default'} onClick={toggle} disabled={pending} className="shrink-0 self-start">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {detail.resolved ? 'Reopen' : 'Mark resolved'}
          </Button>
        </div>
      </div>

      <PageBody>
        <div className="space-y-8">
          <div className="grid gap-4 lg:grid-cols-3">
            <dl className="divide-y rounded-lg border bg-card text-sm lg:col-span-2">
              {facts.map(([label, value]) => (
                <div key={label} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm">
              {(
                [
                  ['Last hour', detail.lastHour],
                  ['Last 24 hours', detail.last24h],
                  ['Last 14 days', detail.last14d],
                  ['In all', detail.count],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="bg-card px-4 py-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{formatNumber(n)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <section aria-labelledby="stack" className="space-y-2">
            <h2 id="stack" className="text-sm font-semibold text-foreground">
              Latest stack trace
            </h2>
            {detail.lastStack ? (
              <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground">
                {detail.lastStack}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">None was sent with it.</p>
            )}
            {detail.source === 'client' && (
              <p className="text-xs text-muted-foreground">
                Browser stack traces point at the minified build, so file names and line numbers are approximate.
              </p>
            )}
          </section>

          <section aria-labelledby="events" className="space-y-2">
            <div>
              <h2 id="events" className="text-sm font-semibold text-foreground">
                Recent occurrences
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">The latest 25. Each occurrence is kept for 14 days.</p>
            </div>
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>When</TableColumnHeader>
                    <TableColumnHeader>Page</TableColumnHeader>
                    <TableColumnHeader>Site</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detail.events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell muted>
                        <time dateTime={e.occurredAt} title={formatDate(e.occurredAt)}>
                          {formatRelativeTime(e.occurredAt)}
                        </time>
                      </TableCell>
                      <TableCell className="max-w-md truncate font-mono text-xs">{e.path ?? '—'}</TableCell>
                      <TableCell muted className="max-w-xs truncate text-xs">
                        {e.host ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </section>
        </div>
      </PageBody>
    </div>
  );
}
