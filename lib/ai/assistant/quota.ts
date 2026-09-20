/*
 * Who may spend the assistant's budget, and how much of it.
 *
 * Two different limits, doing two different jobs:
 *
 *  1. REQUEST limits (checkAssistantRequest) — per shopper and per store, on
 *     the endpoint itself. Exceeding one is a 429 to the caller: someone is
 *     sending messages faster than a person types.
 *
 *  2. MODEL budget (reserveModelCall) — how many Gemini calls this server
 *     will make, globally and per store, sized under the free tier's quota.
 *     Exceeding it is NOT an error: the provider answers with the
 *     deterministic engine instead, which reads the same catalogue. So one
 *     busy store, or one shopper, can use up only its own share of Gemini —
 *     never take the assistant down for everyone else.
 *
 * A 429 from Gemini itself opens a short cool-down (noteModelRateLimited) so
 * we stop knocking on a closed door until Google says to try again.
 *
 * Built on lib/rate-limit.ts, the project's limiter — in-memory and
 * per-instance. On several instances each keeps its own counters, so the
 * global numbers below should be divided by the instance count (or the
 * limiter moved to a shared store, as that file notes).
 */
import { checkRateLimit } from '@/lib/rate-limit';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/*
 * Defaults sit just UNDER the free tier's per-project limits so our own
 * counter trips before Google's does — a local refusal is instant and
 * degrades to the deterministic engine, a 429 costs a round trip first. The
 * free-tier numbers vary by model and change over time; check yours in AI
 * Studio and override these rather than editing the code.
 */
export function modelLimits() {
  return {
    globalPerMinute: envInt('GEMINI_MAX_RPM', 12),
    globalPerDay: envInt('GEMINI_MAX_RPD', 900),
    storePerMinute: envInt('GEMINI_STORE_MAX_RPM', 6),
    storePerDay: envInt('GEMINI_STORE_MAX_RPD', 250),
  };
}

/*
 * Request limits: generous for a person, tight for a script. The IP limit is
 * looser than the session one because mobile carriers put many shoppers
 * behind one address.
 */
export const REQUEST_LIMITS = {
  sessionPerMinute: { limit: 10, windowMs: MINUTE },
  sessionPerHour: { limit: 80, windowMs: HOUR },
  ipPerMinute: { limit: 30, windowMs: MINUTE },
  ipPerHour: { limit: 300, windowMs: HOUR },
  storePerMinute: { limit: 120, windowMs: MINUTE },
} as const;

export type RequestCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RequestIdentity {
  /** a signed-in shopper's session, hashed — absent for guests */
  session?: string;
  ip: string;
}

/** Every key is namespaced by store, so one store's traffic never counts against another's. */
export function checkAssistantRequest(storeSlug: string, who: RequestIdentity): RequestCheck {
  const L = REQUEST_LIMITS;
  type Check = readonly [string, { readonly limit: number; readonly windowMs: number }];
  const checks: Check[] = [
    ...(who.session
      ? [
          [`assistant:session:min:${storeSlug}:${who.session}`, L.sessionPerMinute] as const,
          [`assistant:session:hour:${storeSlug}:${who.session}`, L.sessionPerHour] as const,
        ]
      : []),
    [`assistant:ip:min:${storeSlug}:${who.ip}`, L.ipPerMinute],
    [`assistant:ip:hour:${storeSlug}:${who.ip}`, L.ipPerHour],
    [`assistant:store:min:${storeSlug}`, L.storePerMinute],
  ];
  for (const [key, { limit, windowMs }] of checks) {
    if (!checkRateLimit(key, limit, windowMs)) {
      return { ok: false, retryAfterSeconds: Math.min(windowMs / 1000, 15 * 60) };
    }
  }
  return { ok: true };
}

/* ───────────────────────────── model budget ─────────────────────────── */

let coolDownUntil = 0;

/**
 * Take one Gemini call from the budget, or learn there isn't one.
 *
 * Store buckets are checked before the global ones so a store that has used
 * its share is refused without eating into everyone else's.
 */
export function reserveModelCall(storeSlug: string): boolean {
  if (Date.now() < coolDownUntil) return false;

  const limits = modelLimits();
  return (
    checkRateLimit(`gemini:store:min:${storeSlug}`, limits.storePerMinute, MINUTE) &&
    checkRateLimit(`gemini:store:day:${storeSlug}`, limits.storePerDay, DAY) &&
    checkRateLimit('gemini:global:min', limits.globalPerMinute, MINUTE) &&
    checkRateLimit('gemini:global:day', limits.globalPerDay, DAY)
  );
}

/** Gemini said 429: stop calling it for as long as it asked (capped). */
export function noteModelRateLimited(retryAfterMs: number | undefined): void {
  const wait = Math.min(Math.max(retryAfterMs ?? MINUTE, 5_000), 10 * MINUTE);
  coolDownUntil = Math.max(coolDownUntil, Date.now() + wait);
}

/** Test seam. */
export function resetModelCoolDown(): void {
  coolDownUntil = 0;
}
