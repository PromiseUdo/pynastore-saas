/*
 * GET /api/health
 *
 * For the uptime check (ROADMAP 13.3; cron-job.org, see
 * docs/SCHEDULED-JOBS.md): 200 when the app is up and can reach its
 * database, 503 when it can't. Says nothing else — no versions of
 * dependencies, no configuration — since anyone can call it.
 */
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const DATABASE_TIMEOUT_MS = 5_000;

async function databaseOk(): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DATABASE_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const database = await databaseOk();
  return Response.json(
    {
      status: database ? 'ok' : 'down',
      checks: { database: database ? 'ok' : 'unreachable' },
      // Which deployment answered — the short commit, when Vercel provides it.
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      time: new Date().toISOString(),
    },
    { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
