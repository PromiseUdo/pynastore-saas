/*
 * Request limits for POST /api/storefront/discover — the homepage's
 * "Search or describe what you need" bar, shopping missions, budget bands and
 * "Help me choose".
 *
 * Same shape as the assistant's (lib/ai/assistant/quota.ts), visual search's
 * and recommendations' (lib/storefront/recommendations/quota.ts), on the same
 * limiter (lib/rate-limit.ts — in-memory, per instance): per shopper (signed-in
 * session, hashed) and per IP, plus a per-store ceiling, every key namespaced
 * by store so one merchant's traffic never consumes another's.
 *
 * No model is involved — the search is deterministic — but each request reads
 * the store's catalogue several times, so a script looping on it is load on
 * the database. A person submits the bar or taps a tile a few times a minute;
 * these limits sit well above that and well below a loop.
 */
import { checkRateLimit } from '@/lib/rate-limit';
import type { RequestIdentity } from './request-identity';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const DISCOVERY_LIMITS = {
  sessionPerMinute: { limit: 30, windowMs: MINUTE },
  sessionPerHour: { limit: 400, windowMs: HOUR },
  // looser than the session limit: mobile carriers put many shoppers behind one address
  ipPerMinute: { limit: 60, windowMs: MINUTE },
  ipPerHour: { limit: 1_000, windowMs: HOUR },
  storePerMinute: { limit: 600, windowMs: MINUTE },
} as const;

export type DiscoveryRequestCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

export function checkDiscoveryRequest(storeSlug: string, who: RequestIdentity): DiscoveryRequestCheck {
  const L = DISCOVERY_LIMITS;
  type Check = readonly [string, { readonly limit: number; readonly windowMs: number }];
  const checks: Check[] = [
    ...(who.session
      ? [
          [`discover:session:min:${storeSlug}:${who.session}`, L.sessionPerMinute] as const,
          [`discover:session:hour:${storeSlug}:${who.session}`, L.sessionPerHour] as const,
        ]
      : []),
    [`discover:ip:min:${storeSlug}:${who.ip}`, L.ipPerMinute],
    [`discover:ip:hour:${storeSlug}:${who.ip}`, L.ipPerHour],
    [`discover:store:min:${storeSlug}`, L.storePerMinute],
  ];
  for (const [key, { limit, windowMs }] of checks) {
    if (!checkRateLimit(key, limit, windowMs)) {
      return { ok: false, retryAfterSeconds: Math.min(windowMs / 1000, 15 * 60) };
    }
  }
  return { ok: true };
}
