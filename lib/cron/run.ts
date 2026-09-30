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
 * Staff alerts go to PLATFORM_ADMIN_EMAIL, at most every ALERT_EVERY_HOURS
 * per job while it stays broken, and once more when it works again. Only
 * scheduled runs alert on failure: whoever pressed "Run now" is looking at
 * the answer already.
 */
import { prisma } from '@/lib/prisma';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { PLATFORM_NAME } from '@/lib/brand';
import { formatRelativeTime } from '@/lib/format';
import { CRON_JOBS, type CronJob } from './jobs';
import { ALERT_EVERY_HOURS, jobState } from './health';

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
    if (outcome.ok) await clearAlerts(key, job);
    else if (options.trigger === 'schedule') await alertFailed(key, job, outcome.error);
    await alertOverdue(jobs, key);
    await prisma.cronRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
  } catch (err) {
    console.error(`[cron] ${key}: couldn't record the run:`, err);
  }

  if (!outcome.ok) console.error(`[cron] ${key} failed:`, outcome.error);
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

function staffInbox(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Claim the right to send this alert: the first time, or when the last one
 * went out more than ALERT_EVERY_HOURS ago. Two runs racing can't both win.
 */
async function claimAlert(job: string, kind: 'failed' | 'overdue'): Promise<boolean> {
  const created = await prisma.cronAlert.createMany({ data: [{ job, kind }], skipDuplicates: true });
  if (created.count === 1) return true;
  const renewed = await prisma.cronAlert.updateMany({
    where: { job, kind, sentAt: { lt: new Date(Date.now() - ALERT_EVERY_HOURS * 3_600_000) } },
    data: { sentAt: new Date() },
  });
  return renewed.count === 1;
}

async function send(subject: string, heading: string, paragraphs: string[]) {
  const to = staffInbox();
  if (to.length === 0) return;
  await sendPlatformNoticeEmail({
    to,
    subject,
    preview: heading,
    heading,
    paragraphs,
    button: { label: 'Open scheduled jobs', url: getMarketingUrl('/platform/jobs') },
    footer: `Sent by ${PLATFORM_NAME} to platform staff, at most every ${ALERT_EVERY_HOURS} hours while a job stays broken.`,
  });
}

async function alertFailed(key: string, job: CronJob, error: string) {
  if (!(await claimAlert(key, 'failed'))) return;
  await send(`Scheduled job failed: ${job.title}`, `“${job.title}” failed`, [
    `It runs ${job.schedule.toLowerCase()}. ${job.description}`,
    `What it said: ${error}`,
    'It will try again at its next run. You can also run it from the console once the cause is fixed.',
  ]);
}

async function clearAlerts(key: string, job: CronJob) {
  const cleared = await prisma.cronAlert.deleteMany({ where: { job: key } });
  if (cleared.count > 0) {
    await send(`Working again: ${job.title}`, `“${job.title}” is working again`, [
      'Its latest run finished without a problem. No more alerts will be sent about it unless it breaks again.',
    ]);
  }
}

/** Email about every other job that should have run by now and hasn't. */
async function alertOverdue(jobs: Record<string, CronJob>, current: string) {
  const now = new Date();
  for (const [key, job] of Object.entries(jobs)) {
    if (key === current) continue;
    const last = await prisma.cronRun.findFirst({
      where: { job: key },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, ok: true },
    });
    const state = jobState(job.everyMinutes, last, now);
    if (state !== 'late' && state !== 'never') continue;
    if (!(await claimAlert(key, 'overdue'))) continue;
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
