/*
 * Request limits for POST /api/storefront/recommendations.
 *
 * Same shape as the assistant's (lib/ai/assistant/quota.ts) and visual
 * search's (lib/storefront/visual-search/quota.ts), on the same limiter
 * (lib/rate-limit.ts — in-memory, per instance): per shopper (signed-in
 * session, hashed) and per IP, plus a per-store ceiling, every key namespaced
 * by store so one store's traffic never counts against another's.
 *
 * Much more generous than those two: this endpoint calls no model, and a
 * normal page asks it several times on its own (one request per block, and
 * again as the bag or wishlist changes — identical requests are already
 * shared client-side). The limits exist to stop a script hammering the
 * catalogue, not to ration a person. A refused request costs the shopper
 * nothing visible: the block keeps its server-rendered, non-personalised
 * version (use-recommendations.ts falls back to `initial` on any error).
 */
import { checkRateLimit } from '@/lib/rate-limit';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RECOMMENDATION_LIMITS = {
  sessionPerMinute: { limit: 60, windowMs: MINUTE },
  sessionPerHour: { limit: 1_000, windowMs: HOUR },
  // looser than the session limit: mobile carriers put many shoppers behind one address
  ipPerMinute: { limit: 120, windowMs: MINUTE },
  ipPerHour: { limit: 2_000, windowMs: HOUR },
  storePerMinute: { limit: 1_500, windowMs: MINUTE },
} as const;

export type RecommendationRequestCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RecommendationRequester {
  /** a signed-in shopper's session, hashed — absent for guests */
  session?: string;
  ip: string;
}

export function checkRecommendationRequest(
  storeSlug: string,
  who: RecommendationRequester,
): RecommendationRequestCheck {
  const L = RECOMMENDATION_LIMITS;
  type Check = readonly [string, { readonly limit: number; readonly windowMs: number }];
  const checks: Check[] = [
    ...(who.session
      ? [
          [`recs:session:min:${storeSlug}:${who.session}`, L.sessionPerMinute] as const,
          [`recs:session:hour:${storeSlug}:${who.session}`, L.sessionPerHour] as const,
        ]
      : []),
    [`recs:ip:min:${storeSlug}:${who.ip}`, L.ipPerMinute],
    [`recs:ip:hour:${storeSlug}:${who.ip}`, L.ipPerHour],
    [`recs:store:min:${storeSlug}`, L.storePerMinute],
  ];
  for (const [key, { limit, windowMs }] of checks) {
    if (!checkRateLimit(key, limit, windowMs)) {
      return { ok: false, retryAfterSeconds: Math.min(windowMs / 1000, 15 * 60) };
    }
  }
  return { ok: true };
}
