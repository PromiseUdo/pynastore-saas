/*
 * lib/cron/route.ts
 *
 * The one GET handler behind every app/api/cron/* route (ROADMAP 13.1): check
 * the scheduler's `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it
 * automatically when CRON_SECRET is set; cron-job.org is told to send it),
 * then run the job through runCronJob, which records it and alerts staff.
 *
 * A failed job answers 500, so the scheduler's own dashboard shows it too.
 */
import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runCronJob } from './run';
import type { CronJobKey } from './jobs';

export function isCronRequestAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function cronRoute(key: CronJobKey) {
  return async function GET(req: NextRequest) {
    if (!isCronRequestAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
      const outcome = await runCronJob(key, { trigger: 'schedule' });
      return outcome.ok
        ? NextResponse.json(outcome.result ?? { ok: true })
        : NextResponse.json({ error: 'Failed' }, { status: 500 });
    } catch (error) {
      // Couldn't even start a run (e.g. the database is unreachable).
      console.error(`[cron] ${key} couldn't start:`, error);
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  };
}
