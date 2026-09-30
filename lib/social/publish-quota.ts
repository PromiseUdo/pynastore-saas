/*
 * How often a merchant may ask us to retry a post.
 *
 * A retry is the one button in the dashboard that makes a real write call to
 * Meta on demand, so it gets the same treatment as every other outward call
 * in this codebase: the project's own limiter (lib/rate-limit.ts), keyed per
 * store and per member, sized for a person rather than a script. No queue, no
 * new dependency — the same shape as lib/ai/social/quota.ts,
 * lib/ai/assistant/quota.ts and lib/storefront/visual-search/quota.ts.
 *
 * This is not a fairness mechanism between stores (each keeps its own
 * bucket); it exists so a stuck retry button can't hammer Graph and get the
 * whole platform app throttled for every merchant at once.
 *
 * Counted in the shared store, like the rest, so it holds across instances.
 */
import { requestLimitRetryAfter } from '@/lib/rate-limit';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/*
 * Retrying is a considered act — a merchant reads the error, fixes something,
 * tries again. Ten in a minute is already impatient; sixty in an hour is not
 * a shopkeeper.
 */
export const RETRY_LIMITS = {
  memberPerMinute: { limit: 10, windowMs: MINUTE },
  storePerHour: { limit: 60, windowMs: HOUR },
} as const;

export type RetryCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Both ids come from the session; neither is ever read from a form. */
export async function checkRetryRequest(organizationId: string, userId: string): Promise<RetryCheck> {
  const checks = [
    [`social-retry:member:${organizationId}:${userId}`, RETRY_LIMITS.memberPerMinute],
    [`social-retry:store:${organizationId}`, RETRY_LIMITS.storePerHour],
  ] as const;

  const retryAfterSeconds = await requestLimitRetryAfter(checks.map(([key, l]) => ({ key, ...l })));
  return retryAfterSeconds === null ? { ok: true } : { ok: false, retryAfterSeconds };
}
