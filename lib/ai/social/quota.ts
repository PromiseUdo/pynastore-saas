/*
 * Who may spend the copywriter's Gemini budget, and how much.
 *
 * Same two-layer shape as the Shopping Assistant (lib/ai/assistant/quota.ts)
 * and Visual Search (lib/storefront/visual-search/quota.ts), on the same
 * limiter (lib/rate-limit.ts — in-memory, per instance):
 *
 *  1. REQUEST limits — per member and per store, checked before the model is
 *     called. Exceeding one tells the merchant to wait a moment.
 *
 *  2. MODEL budget — how many Gemini calls this server will make for social
 *     copy, globally and per store, sized under the free tier and SEPARATE
 *     from the shopper-facing budgets so a merchant writing captions can
 *     never use up the quota that answers customers.
 *
 * One difference from the shopper-facing quotas, and it matters: when the
 * assistant runs out of budget it falls back to a deterministic engine, so a
 * shopper still gets an answer. There is no deterministic copywriter — a
 * caption is either written by the model or not written at all. So running
 * out here is reported to the merchant as "try again in a minute", never
 * papered over with generated-sounding filler.
 *
 * These limits are deliberately tight. Caption writing is a button a person
 * presses a few times per post, not a background job.
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
 * Request limits. A merchant writing one post might press Generate, then
 * Rewrite two or three ways, then Generate hashtags — call it a dozen in a
 * busy minute. Well past that is a script, not a shopkeeper.
 */
export const COPY_REQUEST_LIMITS = {
  memberPerMinute: { limit: 12, windowMs: MINUTE },
  memberPerHour: { limit: 120, windowMs: HOUR },
  storePerMinute: { limit: 30, windowMs: MINUTE },
  storePerDay: { limit: 600, windowMs: DAY },
} as const;

export function copyModelLimits() {
  return {
    globalPerMinute: envInt('GEMINI_SOCIAL_MAX_RPM', 10),
    globalPerDay: envInt('GEMINI_SOCIAL_MAX_RPD', 500),
    storePerMinute: envInt('GEMINI_SOCIAL_STORE_MAX_RPM', 6),
    storePerDay: envInt('GEMINI_SOCIAL_STORE_MAX_RPD', 150),
  };
}

export type CopyRequestCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Per-member and per-store request limits.
 *
 * Keyed by organizationId AND userId, both taken from the session — so one
 * store's traffic never counts against another's, and one member can't spend
 * a colleague's allowance. There is no IP key here (unlike the shopper
 * quotas): this endpoint is only reachable by an authenticated member, so
 * the member IS the identity.
 */
export function checkCopyRequest(organizationId: string, userId: string): CopyRequestCheck {
  const L = COPY_REQUEST_LIMITS;
  const checks = [
    [`social-copy:member:min:${organizationId}:${userId}`, L.memberPerMinute],
    [`social-copy:member:hour:${organizationId}:${userId}`, L.memberPerHour],
    [`social-copy:store:min:${organizationId}`, L.storePerMinute],
    [`social-copy:store:day:${organizationId}`, L.storePerDay],
  ] as const;

  for (const [key, { limit, windowMs }] of checks) {
    if (!checkRateLimit(key, limit, windowMs)) {
      return { ok: false, retryAfterSeconds: Math.min(windowMs / 1000, 15 * 60) };
    }
  }
  return { ok: true };
}

/* ───────────────────────────── model budget ─────────────────────────── */

let coolDownUntil = 0;

export function copyCoolingDown(): boolean {
  return Date.now() < coolDownUntil;
}

/**
 * Take one Gemini call from the social-copy budget, or learn there isn't
 * one. Store buckets are checked first so a store that has used its share is
 * refused without eating into everyone else's.
 */
export function reserveCopyCall(organizationId: string): boolean {
  if (copyCoolingDown()) return false;

  const l = copyModelLimits();
  return (
    checkRateLimit(`gemini-social:store:min:${organizationId}`, l.storePerMinute, MINUTE) &&
    checkRateLimit(`gemini-social:store:day:${organizationId}`, l.storePerDay, DAY) &&
    checkRateLimit('gemini-social:global:min', l.globalPerMinute, MINUTE) &&
    checkRateLimit('gemini-social:global:day', l.globalPerDay, DAY)
  );
}

/** Gemini said 429: stop calling it for as long as it asked (capped). */
export function noteCopyRateLimited(retryAfterMs: number | undefined): void {
  const wait = Math.min(Math.max(retryAfterMs ?? MINUTE, 5_000), 10 * MINUTE);
  coolDownUntil = Math.max(coolDownUntil, Date.now() + wait);
}

/** Test seam. */
export function resetCopyCoolDown(): void {
  coolDownUntil = 0;
}
