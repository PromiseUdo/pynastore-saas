/*
 * lib/cron/health.ts
 *
 * Whether a scheduled job is doing its job (ROADMAP 13.1), from its latest
 * run. Pure: the console, the overview count and the overdue alerts all ask
 * this one function.
 *
 * "Late" matters most. A scheduler that stops calling us fails nothing — the
 * job just goes quiet — so the only way to notice is to expect the next run.
 */

/** A run still unfinished after this long was cut off by the host (Vercel stops a function at its time limit). */
export const CUT_OFF_MINUTES = 10;

export type JobState = 'ok' | 'running' | 'failing' | 'late' | 'never';

export interface LastRun {
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean | null;
}

/**
 * How long after its last start a job counts as late: three missed beats for
 * a frequent job (45 minutes for every-15), two hours' slack for a daily one
 * (Vercel only promises a daily job somewhere within its hour).
 */
export function lateAfterMinutes(everyMinutes: number): number {
  return everyMinutes < 60 ? everyMinutes * 3 : everyMinutes + 120;
}

/**
 * `watchingSince` is when runs started being recorded at all — the first run
 * of ANY job. A job that has never run is only late once that is further back
 * than its own window: a daily job deployed this afternoon hasn't missed
 * anything until tomorrow morning has come and gone.
 */
export function jobState(everyMinutes: number, last: LastRun | null, now: Date, watchingSince: Date | null = null): JobState {
  if (!last) {
    const watchedFor = watchingSince ? (now.getTime() - watchingSince.getTime()) / 60_000 : 0;
    return watchedFor > lateAfterMinutes(everyMinutes) ? 'late' : 'never';
  }
  const sinceStart = (now.getTime() - last.startedAt.getTime()) / 60_000;
  if (sinceStart > lateAfterMinutes(everyMinutes)) return 'late';
  if (!last.finishedAt) return sinceStart < CUT_OFF_MINUTES ? 'running' : 'failing';
  return last.ok ? 'ok' : 'failing';
}

/** The states that want someone to look. "Never" alone doesn't: it becomes "late" when a run is overdue. */
export function needsAttention(state: JobState): boolean {
  return state === 'failing' || state === 'late';
}
