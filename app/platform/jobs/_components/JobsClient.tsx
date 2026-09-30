'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Clock, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/empty-state';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { runJobNow, type JobRow, type JobsPage, type RunRow } from '@/features/platform/jobs';

type BadgeVariant = 'success' | 'processing' | 'destructive' | 'warning' | 'info';

const STATE: Record<JobRow['state'], { label: string; variant: BadgeVariant }> = {
  ok: { label: 'Working', variant: 'success' },
  running: { label: 'Running', variant: 'processing' },
  failing: { label: 'Failing', variant: 'destructive' },
  late: { label: 'Not running', variant: 'warning' },
  never: { label: 'Hasn’t run yet', variant: 'info' },
};

const OUTCOME: Record<RunRow['outcome'], { label: string; variant: BadgeVariant }> = {
  ok: { label: 'Worked', variant: 'success' },
  running: { label: 'Running', variant: 'processing' },
  failed: { label: 'Failed', variant: 'destructive' },
  'cut-off': { label: 'Didn’t finish', variant: 'destructive' },
};

function took(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return 'Under a second';
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function JobsClient({ data, jobFilter }: { data: JobsPage; jobFilter: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function filterBy(job: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (job === 'all') next.delete('job');
    else next.set('job', job);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-8">
      {data.secretMissing && (
        <Callout tone="danger">
          CRON_SECRET isn’t set on this server, so no scheduler can start any of these jobs — every call is turned
          away. Set it in the host’s environment variables, and give cron-job.org the same value.
        </Callout>
      )}
      {data.alertsOff && (
        <Callout tone="warning">
          PLATFORM_ADMIN_EMAIL isn’t set, so failures are recorded here but nobody is emailed about them.
        </Callout>
      )}

      <section aria-labelledby="jobs" className="space-y-3">
        <h2 id="jobs" className="text-sm font-semibold text-foreground">
          Jobs
        </h2>
        <ul className="divide-y rounded-lg border bg-card">
          {data.jobs.map((job) => (
            <JobItem key={job.key} job={job} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="runs" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="runs" className="text-sm font-semibold text-foreground">
              Recent runs
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">The latest 30, newest first. Runs are kept for 30 days.</p>
          </div>
          <SelectRoot value={jobFilter || 'all'} onValueChange={filterBy}>
            <SelectTrigger className="w-full sm:w-64" aria-label="Show runs of">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs</SelectItem>
              {data.jobs.map((job) => (
                <SelectItem key={job.key} value={job.key}>
                  {job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>

        {data.runs.length === 0 ? (
          <EmptyState
            variant={jobFilter ? 'filtered' : 'empty'}
            icon={Clock}
            title={jobFilter ? 'This job hasn’t run yet' : 'No runs yet'}
            description="A run appears here as soon as a scheduler calls a job, or someone presses “Run now”."
            action={
              jobFilter ? (
                <Button variant="outline" size="sm" onClick={() => filterBy('all')}>
                  Show all jobs
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Job</TableColumnHeader>
                  <TableColumnHeader>Started</TableColumnHeader>
                  <TableColumnHeader>Started by</TableColumnHeader>
                  <TableColumnHeader align="right">Took</TableColumnHeader>
                  <TableColumnHeader>Result</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium text-foreground">{run.jobTitle}</TableCell>
                    <TableCell muted>
                      <time dateTime={run.startedAt} title={formatDate(run.startedAt)}>
                        {formatRelativeTime(run.startedAt)}
                      </time>
                    </TableCell>
                    <TableCell muted>{run.trigger === 'manual' ? (run.startedBy ?? '—') : 'Schedule'}</TableCell>
                    <TableCell align="right" muted className="tabular-nums">
                      {took(run.durationMs)}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <Badge variant={OUTCOME[run.outcome].variant} className="self-start">
                          {OUTCOME[run.outcome].label}
                        </Badge>
                        <span className="max-w-md truncate text-xs text-muted-foreground" title={run.summary ?? undefined}>
                          {run.outcome === 'cut-off' ? 'The host stopped it before it finished.' : (run.summary ?? '')}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </section>
    </div>
  );
}

function JobItem({ job }: { job: JobRow }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const state = STATE[job.state];

  function runNow() {
    startTransition(async () => {
      const result = await runJobNow(job.key);
      if (!result.success) toast.error(result.error);
      else if (result.data.ok) toast.success(`${job.title}: ${result.data.message}`);
      else toast.error(`${job.title}: ${result.data.message}`);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{job.title}</h3>
          <Badge variant={state.variant}>{state.label}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{job.description}</p>
        <p className="text-xs text-muted-foreground">
          {job.schedule}
          {' · '}
          {job.lastRunAt ? `last ran ${formatRelativeTime(job.lastRunAt)}` : 'never run'}
          {job.lastRunAt && job.state !== 'ok' && job.state !== 'running' && (
            <>
              {' · '}
              {job.lastSuccessAt ? `last worked ${formatRelativeTime(job.lastSuccessAt)}` : 'has never worked'}
            </>
          )}
        </p>
        {job.state === 'late' && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {job.lastRunAt ? 'Nothing has called it since.' : 'Nothing has called it yet, though it’s past due.'} Check its
            scheduler and that CRON_SECRET matches on both sides.
          </p>
        )}
        {job.state === 'never' && (
          <p className="text-xs text-muted-foreground">
            Its first run is due at its next scheduled time. If that passes with no run, it will show as not running
            and staff will be emailed.
          </p>
        )}
        {job.lastError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive break-words">
            {job.lastError}
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={runNow} disabled={pending || job.state === 'running'} className="shrink-0 self-start">
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        {pending ? 'Running…' : 'Run now'}
      </Button>
    </li>
  );
}

function Callout({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === 'danger'
          ? 'flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive'
          : 'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
      }
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
