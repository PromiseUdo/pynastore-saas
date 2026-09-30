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
 * Built on lib/rate-limit.ts, the project's limiter, whose counters and
 * cool-downs every server instance shares (ROADMAP 13.2) — so the global
 * numbers below are the platform's, not one instance's.
 */
import { clearRateLimit, coolDown, requestLimitRetryAfter, takeRateLimits } from '@/lib/rate-limit';

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
export async function checkAssistantRequest(storeSlug: string, who: RequestIdentity): Promise<RequestCheck> {
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
  const retryAfterSeconds = await requestLimitRetryAfter(checks.map(([key, l]) => ({ key, ...l })));
  return retryAfterSeconds === null ? { ok: true } : { ok: false, retryAfterSeconds };
}

/* ───────────────────────────── model budget ─────────────────────────── */

/** While this runs (after a Gemini 429), no assistant call is made, on any instance. */
const COOL_DOWN_KEY = 'cooldown:gemini-assistant';

/**
 * Take one Gemini call from the budget, or learn there isn't one.
 *
 * Store buckets are checked before the global ones so a store that has used
 * its share is refused without eating into everyone else's. If the shared
 * store can't be reached, the answer is no — the deterministic engine
 * answers instead.
 */
export async function reserveModelCall(storeSlug: string): Promise<boolean> {
  const limits = modelLimits();
  const taken = await takeRateLimits(
    [
      { key: `gemini:store:min:${storeSlug}`, limit: limits.storePerMinute, windowMs: MINUTE },
      { key: `gemini:store:day:${storeSlug}`, limit: limits.storePerDay, windowMs: DAY },
      { key: 'gemini:global:min', limit: limits.globalPerMinute, windowMs: MINUTE },
      { key: 'gemini:global:day', limit: limits.globalPerDay, windowMs: DAY },
    ],
    { blockedBy: COOL_DOWN_KEY, onError: 'deny' },
  );
  return taken.ok;
}

/** Gemini said 429: stop calling it for as long as it asked (capped). */
export async function noteModelRateLimited(retryAfterMs: number | undefined): Promise<void> {
  const wait = Math.min(Math.max(retryAfterMs ?? MINUTE, 5_000), 10 * MINUTE);
  await coolDown(COOL_DOWN_KEY, wait);
}

/** Test seam. */
export async function resetModelCoolDown(): Promise<void> {
  await clearRateLimit(COOL_DOWN_KEY);
}
