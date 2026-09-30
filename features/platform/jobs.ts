'use server';

/*
 * features/platform/jobs.ts
 *
 * Scheduled jobs, for platform staff (ROADMAP 13.1): whether each one is
 * running when it should, what its runs said, and "Run now" for when a
 * scheduler missed one or a fix needs trying.
 */
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { CRON_JOBS, CRON_JOB_KEYS, isCronJobKey, type CronJobKey, type Counts } from '@/lib/cron/jobs';
import { CUT_OFF_MINUTES, jobState, lateAfterMinutes, needsAttention, type JobState } from '@/lib/cron/health';
import { firstRecordedRun, runCronJob } from '@/lib/cron/run';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface JobRow {
  key: CronJobKey;
  title: string;
  description: string;
  schedule: string;
  state: JobState;
  /** When it counts as late, if it doesn't run again — for the "due by" hint. */
  lateAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface RunRow {
  id: string;
  job: CronJobKey | string;
  jobTitle: string;
  trigger: 'schedule' | 'manual';
  startedBy: string | null;
  startedAt: string;
  durationMs: number | null;
  /** 'running' only while younger than the cut-off; after that it's 'cut-off'. */
  outcome: 'ok' | 'failed' | 'running' | 'cut-off';
  summary: string | null;
}

export interface JobsPage {
  jobs: JobRow[];
  runs: RunRow[];
  /** CRON_SECRET unset: no scheduler can call any job. */
  secretMissing: boolean;
  /** PLATFORM_ADMIN_EMAIL unset: failures are recorded but nobody is emailed. */
  alertsOff: boolean;
}

async function latestRuns() {
  return Promise.all(
    CRON_JOB_KEYS.map(async (key) => {
      const [last, lastOk] = await Promise.all([
        prisma.cronRun.findFirst({
          where: { job: key },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true, finishedAt: true, ok: true, error: true },
        }),
        prisma.cronRun.findFirst({ where: { job: key, ok: true }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
      ]);
      return { key, last, lastOk };
    }),
  );
}

/** For the console nav and overview: jobs failing, late, or never run. */
export async function jobsAttentionCount(): Promise<number> {
  try {
    await requirePlatformStaff();
    const now = new Date();
    const [rows, watchingSince] = await Promise.all([latestRuns(), firstRecordedRun(CRON_JOB_KEYS)]);
    return rows.filter(({ key, last }) => needsAttention(jobState(CRON_JOBS[key].everyMinutes, last, now, watchingSince))).length;
  } catch {
    return 0;
  }
}

/** A run's result in a few words, from the job's own describe(). */
function summarise(job: string, result: unknown): string | null {
  if (!isCronJobKey(job) || !result || typeof result !== 'object' || Array.isArray(result)) return null;
  return CRON_JOBS[job].describe(result as Counts) || null;
}

export async function getJobsPage(params: { job?: string }): Promise<ActionResult<JobsPage>> {
  try {
    await requirePlatformStaff();
    const now = new Date();
    const filter = params.job && isCronJobKey(params.job) ? params.job : undefined;

    const [latest, watchingSince, runs] = await Promise.all([
      latestRuns(),
      firstRecordedRun(CRON_JOB_KEYS),
      prisma.cronRun.findMany({
        where: filter ? { job: filter } : {},
        orderBy: { startedAt: 'desc' },
        take: 30,
        select: { id: true, job: true, trigger: true, startedById: true, startedAt: true, finishedAt: true, ok: true, durationMs: true, result: true, error: true },
      }),
    ]);

    const staffIds = [...new Set(runs.map((r) => r.startedById).filter((id): id is string => Boolean(id)))];
    const staff = staffIds.length
      ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, email: true } })
      : [];
    const staffName = new Map(staff.map((u) => [u.id, u.name ?? u.email]));

    const jobs: JobRow[] = latest.map(({ key, last, lastOk }) => {
      const job = CRON_JOBS[key];
      const state = jobState(job.everyMinutes, last, now, watchingSince);
      return {
        key,
        title: job.title,
        description: job.description,
        schedule: job.schedule,
        state,
        lateAt: last ? new Date(last.startedAt.getTime() + lateAfterMinutes(job.everyMinutes) * 60_000).toISOString() : null,
        lastRunAt: last?.startedAt.toISOString() ?? null,
        lastSuccessAt: lastOk?.startedAt.toISOString() ?? null,
        lastError: state === 'failing' ? (last?.error ?? 'It stopped before finishing — the host probably cut it off.') : null,
      };
    });

    return {
      success: true,
      data: {
        jobs,
        runs: runs.map((r): RunRow => {
          const unfinishedFor = (now.getTime() - r.startedAt.getTime()) / 60_000;
          const outcome = r.finishedAt ? (r.ok ? 'ok' : 'failed') : unfinishedFor < CUT_OFF_MINUTES ? 'running' : 'cut-off';
          return {
            id: r.id,
            job: r.job,
            jobTitle: isCronJobKey(r.job) ? CRON_JOBS[r.job].title : r.job,
            trigger: r.trigger === 'manual' ? 'manual' : 'schedule',
            startedBy: r.startedById ? (staffName.get(r.startedById) ?? 'A former staff member') : null,
            startedAt: r.startedAt.toISOString(),
            durationMs: r.durationMs,
            outcome,
            summary: outcome === 'failed' ? r.error : outcome === 'ok' ? summarise(r.job, r.result) : null,
          };
        }),
        secretMissing: !process.env.CRON_SECRET,
        alertsOff: !process.env.PLATFORM_ADMIN_EMAIL?.trim(),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.name === 'PlatformAccessDeniedError' ? 'Not allowed.' : 'We couldn’t load the scheduled jobs.' };
  }
}

/** "Run now": the same run a scheduler would start, recorded as started by this staff member. */
export async function runJobNow(key: string): Promise<ActionResult<{ ok: boolean; message: string }>> {
  try {
    const staff = await requirePlatformStaff();
    if (!isCronJobKey(key)) return { success: false, error: 'There’s no such job.' };

    // Don't start a second copy of a run that's still going.
    const running = await prisma.cronRun.findFirst({
      where: { job: key, finishedAt: null, startedAt: { gt: new Date(Date.now() - CUT_OFF_MINUTES * 60_000) } },
      select: { id: true },
    });
    if (running) return { success: false, error: 'It’s running right now. Wait for it to finish, then look at the result.' };

    const outcome = await runCronJob(key, { trigger: 'manual', startedById: staff.userId });
    if (outcome.ok) {
      const summary = summarise(key, outcome.result);
      return { success: true, data: { ok: true, message: summary ? `Done — ${summary}.` : 'Done.' } };
    }
    return { success: true, data: { ok: false, message: `It failed: ${outcome.error}` } };
  } catch (error) {
    if (error instanceof Error && error.name === 'PlatformAccessDeniedError') return { success: false, error: 'Not allowed.' };
    console.error('[platform/jobs] run now failed:', error);
    return { success: false, error: 'We couldn’t start it. Try again in a minute.' };
  }
}
