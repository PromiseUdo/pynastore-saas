/*
 * lib/rate-limit.ts
 *
 * The project's rate limiter (ROADMAP 13.2) — fixed windows, counted in ONE
 * place that every server instance shares: the `rate_limit_buckets` table,
 * written only through the `rate_limit_take()` SQL function (migration
 * 20261001120000_shared_rate_limits). On Vercel each request can land on a
 * different instance, so counters kept in memory never held.
 *
 * Three things are built on it:
 *   - request limits (sign-in, checkout, questions…): "someone is going
 *     faster than a person";
 *   - model budgets (Gemini): how many calls the whole platform makes, per
 *     store and in total, under Google's free-tier quota;
 *   - cool-downs: after a Gemini 429, stop calling for as long as it asked.
 *
 * A chain of buckets is taken in one database round trip, in order, stopping
 * at the first full one — the ones before it stay counted, the rest are
 * untouched — exactly like the `a && b && c` chains this replaced.
 *
 * If the database can't be reached, request limits let the request through
 * (it will most likely fail on its own next query) and model budgets refuse
 * (the caller falls back to its no-AI answer). Each caller picks, below.
 *
 * Under vitest the counters live in memory unless RATE_LIMIT_STORE=database,
 * so unit tests don't need a database; tests/rate-limit.test.ts runs the SQL
 * function itself.
 */
import { prisma } from '@/lib/prisma';

export interface LimitCheck {
  key: string;
  limit: number;
  windowMs: number;
}

export type TakeResult =
  | { ok: true }
  /** `refused` is the full bucket, or null when a cool-down blocked the call. */
  | { ok: false; refused: LimitCheck | null };

export interface TakeOptions {
  /** A cool-down key (see coolDown): while it runs, refuse without counting anything. */
  blockedBy?: string;
  /** When the store can't be reached: 'allow' for request limits, 'deny' for budgets. Default 'allow'. */
  onError?: 'allow' | 'deny';
}

function useMemory(): boolean {
  const store = process.env.RATE_LIMIT_STORE;
  if (store === 'memory') return true;
  if (store === 'database') return false;
  return Boolean(process.env.VITEST);
}

/* ─── The shared store ──────────────────────────────────────────────────── */

let lastErrorLogged = 0;
function logStoreError(error: unknown) {
  // One line a minute, not one per request, while the database is unreachable.
  if (Date.now() - lastErrorLogged < 60_000) return;
  lastErrorLogged = Date.now();
  console.error('[rate-limit] shared store unavailable:', error instanceof Error ? error.message : error);
}

/** Now and then, delete buckets that expired over an hour ago. Fire-and-forget. */
function maybeSweep() {
  if (Math.random() > 0.005) return;
  prisma.$executeRaw`DELETE FROM rate_limit_buckets WHERE "resetAt" < (now() AT TIME ZONE 'UTC') - INTERVAL '1 hour'`.catch(
    () => {},
  );
}

async function takeShared(checks: LimitCheck[], blockedBy: string | null): Promise<number> {
  const keys = checks.map((c) => c.key);
  const limits = checks.map((c) => Math.floor(c.limit));
  const windows = checks.map((c) => Math.max(1, Math.floor(c.windowMs)));
  const rows = await prisma.$queryRaw<{ r: number }[]>`
    SELECT rate_limit_take(${keys}::text[], ${limits}::int[], ${windows}::bigint[], ${blockedBy}::text) AS r`;
  maybeSweep();
  return Number(rows[0]?.r ?? -1);
}

/* ─── The in-memory store (tests, or RATE_LIMIT_STORE=memory) ───────────── */

const buckets = new Map<string, { count: number; resetAt: number }>();

function takeMemory(checks: LimitCheck[], blockedBy: string | null): number {
  const now = Date.now();
  if (blockedBy && (buckets.get(blockedBy)?.resetAt ?? 0) > now) return 0;
  for (let i = 0; i < checks.length; i += 1) {
    const { key, limit, windowMs } = checks[i];
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + windowMs });
    else if (bucket.count >= limit) return i + 1;
    else bucket.count += 1;
  }
  return -1;
}

/* ─── The API ───────────────────────────────────────────────────────────── */

/** Take one from each bucket in order, stopping at the first that's full. */
export async function takeRateLimits(checks: LimitCheck[], options: TakeOptions = {}): Promise<TakeResult> {
  const blockedBy = options.blockedBy ?? null;
  let r: number;
  try {
    r = useMemory() ? takeMemory(checks, blockedBy) : await takeShared(checks, blockedBy);
  } catch (error) {
    logStoreError(error);
    return options.onError === 'deny' ? { ok: false, refused: null } : { ok: true };
  }
  if (r === -1) return { ok: true };
  return { ok: false, refused: r === 0 ? null : (checks[r - 1] ?? null) };
}

/**
 * True if the action identified by `key` is still within `limit` per
 * `windowMs`, counting this one. A request limit: lets it through if the
 * store is unreachable.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  return (await takeRateLimits([{ key, limit, windowMs }])).ok;
}

/**
 * For a chain of request limits: null if every bucket had room, otherwise
 * how long to tell the caller to wait (the full bucket's window, capped at
 * 15 minutes).
 */
export async function requestLimitRetryAfter(checks: LimitCheck[]): Promise<number | null> {
  const result = await takeRateLimits(checks);
  if (result.ok) return null;
  return Math.min((result.refused?.windowMs ?? 60_000) / 1000, 15 * 60);
}

/** Pause everything `blockedBy: key` guards for `ms` (never shortening a pause already running). */
export async function coolDown(key: string, ms: number): Promise<void> {
  if (useMemory()) {
    const until = Date.now() + ms;
    buckets.set(key, { count: 0, resetAt: Math.max(buckets.get(key)?.resetAt ?? 0, until) });
    return;
  }
  try {
    await prisma.$executeRaw`
      INSERT INTO rate_limit_buckets AS b ("key", "count", "resetAt")
      VALUES (${key}, 0, (now() AT TIME ZONE 'UTC') + ${Math.floor(ms)} * INTERVAL '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET "resetAt" = GREATEST(b."resetAt", EXCLUDED."resetAt")`;
  } catch (error) {
    logStoreError(error);
  }
}

/** Test seam: forget a bucket or cool-down. */
export async function clearRateLimit(key: string): Promise<void> {
  buckets.delete(key);
  if (useMemory()) return;
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
