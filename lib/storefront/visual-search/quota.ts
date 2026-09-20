/*
 * Who may spend the image-embedding quota, and how much.
 *
 * Same two-layer shape as the assistant (lib/ai/assistant/quota.ts), on the
 * same limiter (lib/rate-limit.ts — in-memory, per instance):
 *
 *  1. REQUEST limits — per shopper (session, else IP) and per store, checked
 *     before a photo is even read. Exceeding one tells the shopper to wait.
 *
 *  2. EMBEDDING budget — how many Gemini embedding calls this server makes,
 *     globally and per store, sized under the free tier. Shopper searches and
 *     background indexing share the global budget, but indexing has a lower
 *     ceiling of its own so a merchant importing 500 photos can't starve
 *     shoppers. A 429 from Gemini pauses every embedding call for as long as
 *     Google asks.
 *
 * On several server instances each keeps its own counters — divide the
 * global numbers by the instance count, or move the limiter to a shared store.
 */
import { checkRateLimit } from '@/lib/rate-limit';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/* Photos are deliberate actions — nobody searches by image 10 times a minute. */
export const SEARCH_LIMITS = {
  sessionPerMinute: { limit: 6, windowMs: MINUTE },
  sessionPerHour: { limit: 40, windowMs: HOUR },
  // looser: mobile carriers put many shoppers behind one address
  ipPerMinute: { limit: 12, windowMs: MINUTE },
  ipPerHour: { limit: 80, windowMs: HOUR },
  storePerMinute: { limit: 60, windowMs: MINUTE },
} as const;

export function embeddingLimits() {
  return {
    globalPerMinute: envInt('GEMINI_EMBED_MAX_RPM', 50),
    globalPerDay: envInt('GEMINI_EMBED_MAX_RPD', 900),
    storeSearchPerMinute: envInt('GEMINI_EMBED_STORE_MAX_RPM', 20),
    storeSearchPerDay: envInt('GEMINI_EMBED_STORE_MAX_RPD', 300),
    indexingPerMinute: envInt('GEMINI_EMBED_INDEX_MAX_RPM', 30),
  };
}

export type SearchCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface SearcherIdentity {
  /** the signed-in shopper's session, hashed — absent for guests */
  session?: string;
  ip: string;
}

/** Every key is namespaced by store, so one store's traffic never counts against another's. */
export function checkImageSearchRequest(storeSlug: string, who: SearcherIdentity): SearchCheck {
  const L = SEARCH_LIMITS;
  type Check = readonly [string, { readonly limit: number; readonly windowMs: number }];
  const checks: Check[] = [
    ...(who.session
      ? [
          [`vsearch:session:min:${storeSlug}:${who.session}`, L.sessionPerMinute] as const,
          [`vsearch:session:hour:${storeSlug}:${who.session}`, L.sessionPerHour] as const,
        ]
      : []),
    [`vsearch:ip:min:${storeSlug}:${who.ip}`, L.ipPerMinute],
    [`vsearch:ip:hour:${storeSlug}:${who.ip}`, L.ipPerHour],
    [`vsearch:store:min:${storeSlug}`, L.storePerMinute],
  ];
  for (const [key, { limit, windowMs }] of checks) {
    if (!checkRateLimit(key, limit, windowMs)) {
      return { ok: false, retryAfterSeconds: Math.min(windowMs / 1000, 15 * 60) };
    }
  }
  return { ok: true };
}

/* ─────────────────────────── embedding budget ────────────────────────── */

let coolDownUntil = 0;

export function embeddingCoolingDown(): boolean {
  return Date.now() < coolDownUntil;
}

/** One embedding call for a shopper search in this store, or false when the budget is spent. */
export function reserveSearchEmbedding(storeKey: string): boolean {
  if (embeddingCoolingDown()) return false;
  const l = embeddingLimits();
  return (
    checkRateLimit(`gemini-embed:store:min:${storeKey}`, l.storeSearchPerMinute, MINUTE) &&
    checkRateLimit(`gemini-embed:store:day:${storeKey}`, l.storeSearchPerDay, DAY) &&
    checkRateLimit('gemini-embed:global:min', l.globalPerMinute, MINUTE) &&
    checkRateLimit('gemini-embed:global:day', l.globalPerDay, DAY)
  );
}

/** One embedding call for indexing a product image, or false — the job resumes later. */
export function reserveIndexingEmbedding(): boolean {
  if (embeddingCoolingDown()) return false;
  const l = embeddingLimits();
  return (
    checkRateLimit('gemini-embed:index:min', l.indexingPerMinute, MINUTE) &&
    checkRateLimit('gemini-embed:global:min', l.globalPerMinute, MINUTE) &&
    checkRateLimit('gemini-embed:global:day', l.globalPerDay, DAY)
  );
}

/** Gemini said 429: stop embedding for as long as it asked (capped). */
export function noteEmbeddingRateLimited(retryAfterMs: number | undefined): void {
  const wait = Math.min(Math.max(retryAfterMs ?? MINUTE, 5_000), 10 * MINUTE);
  coolDownUntil = Math.max(coolDownUntil, Date.now() + wait);
}

/** Test seam. */
export function resetEmbeddingCoolDown(): void {
  coolDownUntil = 0;
}
