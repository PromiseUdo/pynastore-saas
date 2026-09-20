/*
 * lib/rate-limit.ts
 *
 * Minimal in-memory fixed-window rate limiter. Good enough for a single
 * Node.js instance; state is lost on restart and is NOT shared across
 * serverless/multi-instance deployments. If this app is deployed behind
 * more than one instance, replace this with a shared store (e.g. Upstash
 * Redis) — the call sites in forgot-password/actions.ts only need
 * `checkRateLimit` to keep working the same way.
 */

const buckets = new Map<string, { count: number; resetAt: number }>();

// Opportunistically evict expired buckets so this map doesn't grow forever.
function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Returns true if the action identified by `key` is still within its
 * rate limit, incrementing its counter as a side effect. Returns false
 * once `limit` has been exceeded within `windowMs`.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}
