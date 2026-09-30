/*
 * Scheduled jobs (ROADMAP 13.1): every run is recorded, a failing scheduled
 * job emails staff once (not every 15 minutes) and again when it recovers,
 * and a job nobody is calling is noticed by the others. Against the real
 * database, with a registry of fake jobs so nothing real runs.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const mail = vi.hoisted(() => ({ subjects: [] as string[] }));
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendPlatformNoticeEmail: vi.fn(async (payload: { subject: string }) => {
    mail.subjects.push(payload.subject);
    return true;
  }),
}));

import { prisma } from '@/lib/prisma';
import { runCronJob } from '@/lib/cron/run';
import { CRON_JOBS, type CronJob } from '@/lib/cron/jobs';

vi.setConfig({ testTimeout: 60_000 });

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const OK = `__test-ok-${suffix}`;
const FLAKY = `__test-flaky-${suffix}`;
const QUIET = `__test-quiet-${suffix}`;
let failNext = true;

const job = (title: string, run: () => Promise<unknown>, everyMinutes = 15): CronJob => ({
  title,
  description: 'A test job.',
  schedule: 'Every 15 minutes',
  everyMinutes,
  run,
  describe: () => '',
});

const JOBS: Record<string, CronJob> = {
  [OK]: job('Tidy up', async () => ({ tidied: 3 })),
  [FLAKY]: job('Sometimes breaks', async () => {
    if (failNext) throw new Error('The courier API said no');
    return { ok: 1 };
  }),
};
const keys = [OK, FLAKY, QUIET];

const previousInbox = process.env.PLATFORM_ADMIN_EMAIL;
process.env.PLATFORM_ADMIN_EMAIL = 'staff@example.com';

beforeEach(() => {
  mail.subjects.length = 0;
});

afterAll(async () => {
  await prisma.cronRun.deleteMany({ where: { job: { in: keys } } });
  await prisma.opsAlert.deleteMany({ where: { subject: { in: keys.map((k) => `cron:${k}`) } } });
  process.env.PLATFORM_ADMIN_EMAIL = previousInbox;
});

describe('recording', () => {
  it('writes each run with what it reported and how long it took', async () => {
    const outcome = await runCronJob(OK, { trigger: 'schedule', jobs: JOBS });
    expect(outcome).toMatchObject({ ok: true, result: { tidied: 3 } });
    const row = await prisma.cronRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(row).toMatchObject({ job: OK, trigger: 'schedule', ok: true, error: null, result: { tidied: 3 } });
    expect(row.finishedAt).not.toBeNull();
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('refuses a job that isn’t in the registry', async () => {
    await expect(runCronJob(QUIET, { trigger: 'schedule', jobs: JOBS })).rejects.toThrow(/Unknown scheduled job/);
  });
});

describe('failure alerts', () => {
  it('emails once when a scheduled run fails, not on every failure after it', async () => {
    failNext = true;
    const first = await runCronJob(FLAKY, { trigger: 'schedule', jobs: JOBS });
    expect(first).toMatchObject({ ok: false, error: 'The courier API said no' });
    expect(mail.subjects).toContain('Scheduled job failed: Sometimes breaks');

    mail.subjects.length = 0;
    await runCronJob(FLAKY, { trigger: 'schedule', jobs: JOBS });
    expect(mail.subjects.filter((s) => s.includes('failed'))).toEqual([]);
  });

  it('emails again once the throttle has passed', async () => {
    await prisma.opsAlert.updateMany({ where: { subject: `cron:${FLAKY}`, kind: 'failed' }, data: { sentAt: new Date(Date.now() - 7 * 3_600_000) } });
    await runCronJob(FLAKY, { trigger: 'schedule', jobs: JOBS });
    expect(mail.subjects).toContain('Scheduled job failed: Sometimes breaks');
  });

  it('says so when it works again, and forgets the alert', async () => {
    failNext = false;
    await runCronJob(FLAKY, { trigger: 'schedule', jobs: JOBS });
    expect(mail.subjects).toContain('Working again: Sometimes breaks');
    expect(await prisma.opsAlert.count({ where: { subject: `cron:${FLAKY}` } })).toBe(0);
  });

  it('doesn’t email about a failed “Run now” — the person who pressed it can see', async () => {
    failNext = true;
    const outcome = await runCronJob(FLAKY, { trigger: 'manual', startedById: null, jobs: JOBS });
    expect(outcome.ok).toBe(false);
    expect(mail.subjects.filter((s) => s.includes('failed'))).toEqual([]);
    failNext = false;
  });
});

describe('a job nobody is calling', () => {
  const withQuiet = () => ({ ...JOBS, [QUIET]: job('Never called', async () => ({})) });

  it('isn’t reported just for being new', async () => {
    await runCronJob(OK, { trigger: 'schedule', jobs: withQuiet() });
    expect(mail.subjects.filter((s) => s.includes('isn’t running'))).toEqual([]);
  });

  it('is reported once when it has never run and its window has passed, then not again', async () => {
    // Pretend runs have been recorded for two hours: a 15-minute job with none is overdue.
    await prisma.cronRun.create({
      data: { job: OK, trigger: 'schedule', ok: true, startedAt: new Date(Date.now() - 120 * 60_000), finishedAt: new Date(Date.now() - 120 * 60_000) },
    });
    await runCronJob(OK, { trigger: 'schedule', jobs: withQuiet() });
    expect(mail.subjects).toContain('Scheduled job isn’t running: Never called');
    mail.subjects.length = 0;
    await runCronJob(OK, { trigger: 'schedule', jobs: withQuiet() });
    expect(mail.subjects.filter((s) => s.includes('isn’t running'))).toEqual([]);
  });

  it('is noticed when its last run is too long ago, and cleared when it runs', async () => {
    await prisma.opsAlert.deleteMany({ where: { subject: `cron:${QUIET}` } });
    await prisma.cronRun.create({
      data: { job: QUIET, trigger: 'schedule', ok: true, startedAt: new Date(Date.now() - 90 * 60_000), finishedAt: new Date(Date.now() - 90 * 60_000) },
    });
    await runCronJob(OK, { trigger: 'schedule', jobs: withQuiet() });
    expect(mail.subjects).toContain('Scheduled job isn’t running: Never called');

    await runCronJob(QUIET, { trigger: 'schedule', jobs: withQuiet() });
    expect(mail.subjects).toContain('Working again: Never called');
    expect(await prisma.opsAlert.count({ where: { subject: `cron:${QUIET}` } })).toBe(0);
  });
});

describe('the registry', () => {
  it('has a route for every job, a job for every route, and vercel.json only names real jobs', () => {
    const routes = fs.readdirSync(path.join(process.cwd(), 'app/api/cron')).sort();
    expect(Object.keys(CRON_JOBS).sort()).toEqual(routes);
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };
    for (const cron of vercel.crons) {
      expect(routes).toContain(cron.path.replace('/api/cron/', ''));
      // Hobby allows daily jobs only; a sub-daily schedule fails the deploy.
      expect(cron.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    }
  });
});
