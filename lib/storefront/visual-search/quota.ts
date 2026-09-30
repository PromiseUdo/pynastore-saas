/*
 * Who may spend the image-embedding quota, and how much.
 *
 * Same two-layer shape as the assistant (lib/ai/assistant/quota.ts), on the
 * same limiter (lib/rate-limit.ts — shared by every instance):
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
 * The counters and the pause are shared by every server instance (13.2), so
 * the global numbers are the platform's, not one instance's.
 */
import { clearRateLimit, coolDown, requestLimitRetryAfter, takeRateLimits } from '@/lib/rate-limit';

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
export async function checkImageSearchRequest(storeSlug: string, who: SearcherIdentity): Promise<SearchCheck> {
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
  const retryAfterSeconds = await requestLimitRetryAfter(checks.map(([key, l]) => ({ key, ...l })));
  return retryAfterSeconds === null ? { ok: true } : { ok: false, retryAfterSeconds };
}

/* ─────────────────────────── embedding budget ────────────────────────── */

/** While this runs (after a Gemini 429), no embedding call is made, on any instance. */
const COOL_DOWN_KEY = 'cooldown:gemini-embed';

/** One embedding call for a shopper search in this store, or false when the budget is spent. */
export async function reserveSearchEmbedding(storeKey: string): Promise<boolean> {
  const l = embeddingLimits();
  const taken = await takeRateLimits(
    [
      { key: `gemini-embed:store:min:${storeKey}`, limit: l.storeSearchPerMinute, windowMs: MINUTE },
      { key: `gemini-embed:store:day:${storeKey}`, limit: l.storeSearchPerDay, windowMs: DAY },
      { key: 'gemini-embed:global:min', limit: l.globalPerMinute, windowMs: MINUTE },
      { key: 'gemini-embed:global:day', limit: l.globalPerDay, windowMs: DAY },
    ],
    { blockedBy: COOL_DOWN_KEY, onError: 'deny' },
  );
  return taken.ok;
}

/** One embedding call for indexing a product image, or false — the job resumes later. */
export async function reserveIndexingEmbedding(): Promise<boolean> {
  const l = embeddingLimits();
  const taken = await takeRateLimits(
    [
      { key: 'gemini-embed:index:min', limit: l.indexingPerMinute, windowMs: MINUTE },
      { key: 'gemini-embed:global:min', limit: l.globalPerMinute, windowMs: MINUTE },
      { key: 'gemini-embed:global:day', limit: l.globalPerDay, windowMs: DAY },
    ],
    { blockedBy: COOL_DOWN_KEY, onError: 'deny' },
  );
  return taken.ok;
}

/** Gemini said 429: stop embedding for as long as it asked (capped). */
export async function noteEmbeddingRateLimited(retryAfterMs: number | undefined): Promise<void> {
  const wait = Math.min(Math.max(retryAfterMs ?? MINUTE, 5_000), 10 * MINUTE);
  await coolDown(COOL_DOWN_KEY, wait);
}

/** Test seam. */
export async function resetEmbeddingCoolDown(): Promise<void> {
  await clearRateLimit(COOL_DOWN_KEY);
}
