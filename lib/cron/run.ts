/*
 * lib/cron/run.ts
 *
 * Runs a scheduled job and keeps the record (ROADMAP 13.1). Every caller —
 * the cron routes and the console's "Run now" — comes through here, so every
 * run is written to CronRun whichever scheduler started it.
 *
 * After each run it also looks at the OTHER jobs: one that hasn't run when it
 * should have gets an "overdue" email. That is what catches a scheduler that
 * stopped calling us — the daily jobs (Vercel) watch the frequent ones
 * (cron-job.org), and the other way round.
 *
 * Staff alerts go through lib/ops/alerts.ts: to PLATFORM_ADMIN_EMAIL, at most every 6 hours
 * per job while it stays broken, and once more when it works again. Only
 * scheduled runs alert on failure: whoever pressed "Run now" is looking at
 * the answer already.
 */
import { prisma } from '@/lib/prisma';
import { formatRelativeTime } from '@/lib/format';
import { claimAlert, clearAlerts, sendStaffAlert } from '@/lib/ops/alerts';
import { log } from '@/lib/ops/log';
import { CRON_JOBS, type CronJob } from './jobs';
import { jobState } from './health';

const KEEP_DAYS = 30;
const MAX_RESULT_CHARS = 4000;
const MAX_ERROR_CHARS = 1000;

export type CronTrigger = 'schedule' | 'manual';

export type CronOutcome =
  | { ok: true; runId: string; result: unknown }
  | { ok: false; runId: string; error: string };

/**
 * Run one job and record it. `jobs` is the registry to look it up in — the
 * real one by default; tests pass their own.
 */
export async function runCronJob(
  key: string,
  options: { trigger: CronTrigger; startedById?: string | null; jobs?: Record<string, CronJob> } = { trigger: 'schedule' },
): Promise<CronOutcome> {
  const jobs: Record<string, CronJob> = options.jobs ?? CRON_JOBS;
  const job = jobs[key];
  if (!job) throw new Error(`Unknown scheduled job: ${key}`);

  const run = await prisma.cronRun.create({
    data: { job: key, trigger: options.trigger, startedById: options.startedById ?? null },
    select: { id: true, startedAt: true },
  });

  let outcome: CronOutcome;
  try {
    const result = await job.run();
    outcome = { ok: true, runId: run.id, result };
  } catch (err) {
    outcome = { ok: false, runId: run.id, error: (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS) || 'It failed without saying why.' };
  }

  // The bookkeeping must never turn a job that worked into a failed request.
  try {
    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        durationMs: Date.now() - run.startedAt.getTime(),
        ok: outcome.ok,
        result: outcome.ok ? storable(outcome.result) : undefined,
        error: outcome.ok ? null : outcome.error,
      },
    });
    if (outcome.ok) await clearJobAlerts(key, job);
    else if (options.trigger === 'schedule') await alertFailed(key, job, outcome.error);
    await alertOverdue(jobs, key);
    await prisma.cronRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
  } catch (err) {
    log.error('cron.bookkeeping_failed', { job: key }, err);
  }

  if (outcome.ok) log.info('cron.run', { job: key, trigger: options.trigger, ok: true });
  else log.error('cron.run', { job: key, trigger: options.trigger, ok: false, error: outcome.error });
  return outcome;
}

/** A JSON copy of what the job reported, small enough to keep. */
function storable(result: unknown) {
  if (result === undefined || result === null) return undefined;
  try {
    const json = JSON.stringify(result);
    if (json.length > MAX_RESULT_CHARS) return { note: 'The result was too long to keep.' };
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/* ─── Alerts ────────────────────────────────────────────────────────────── */

const subjectFor = (key: string) => `cron:${key}`;

async function send(subject: string, heading: string, paragraphs: string[]) {
  await sendStaffAlert({ subject, heading, paragraphs, button: { label: 'Open scheduled jobs', path: '/platform/jobs' } });
}

async function alertFailed(key: string, job: CronJob, error: string) {
  if (!(await claimAlert(subjectFor(key), 'failed'))) return;
  await send(`Scheduled job failed: ${job.title}`, `“${job.title}” failed`, [
    `It runs ${job.schedule.toLowerCase()}. ${job.description}`,
    `What it said: ${error}`,
    'It will try again at its next run. You can also run it from the console once the cause is fixed.',
  ]);
}

async function clearJobAlerts(key: string, job: CronJob) {
  if ((await clearAlerts(subjectFor(key))) > 0) {
    await send(`Working again: ${job.title}`, `“${job.title}” is working again`, [
      'Its latest run finished without a problem. No more alerts will be sent about it unless it breaks again.',
    ]);
  }
}

/** When runs of these jobs started being recorded — the reference for "late" on one that has never run. */
export async function firstRecordedRun(keys: string[]): Promise<Date | null> {
  const first = await prisma.cronRun.findFirst({ where: { job: { in: keys } }, orderBy: { startedAt: 'asc' }, select: { startedAt: true } });
  return first?.startedAt ?? null;
}

/** Email about every other job that should have run by now and hasn't. */
async function alertOverdue(jobs: Record<string, CronJob>, current: string) {
  const now = new Date();
  const watchingSince = await firstRecordedRun(Object.keys(jobs));
  for (const [key, job] of Object.entries(jobs)) {
    if (key === current) continue;
    const last = await prisma.cronRun.findFirst({
      where: { job: key },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, ok: true },
    });
    const state = jobState(job.everyMinutes, last, now, watchingSince);
    if (state !== 'late') continue;
    if (!(await claimAlert(subjectFor(key), 'overdue'))) continue;
    await send(
      `Scheduled job isn’t running: ${job.title}`,
      `“${job.title}” hasn’t run when it should have`,
      [
        last
          ? `It last ran ${formatRelativeTime(last.startedAt)}, and it’s meant to run ${job.schedule.toLowerCase()}.`
          : `It has never run, and it’s meant to run ${job.schedule.toLowerCase()}.`,
        job.description,
        'Nothing has failed — nothing is calling it. Check the scheduler (Vercel Cron, or cron-job.org for the every-15-minutes jobs) and that CRON_SECRET matches on both sides.',
      ],
    );
  }
}
