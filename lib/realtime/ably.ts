/*
 * lib/realtime/ably.ts
 *
 * Real-time hints through Ably (server only), shared by chat (lib/chat/ably.ts)
 * and the notification bell (lib/notifications/realtime.ts). The database
 * stays the only source of truth: an event only ever says "something
 * changed, fetch it", and a client that hears one asks through the same
 * routes polling uses.
 *
 * Browsers get listen-only (`subscribe`) tokens for exact channel names —
 * never a wildcard, never `publish` — through token routes that decide the
 * channel from who is asking. The API key never leaves the server.
 *
 * Without ABLY_API_KEY nothing here does anything: no events, no tokens, and
 * every screen keeps polling.
 */
import * as Ably from 'ably';

/** How long a browser's listen token lasts; the SDK renews it before then (authCallback). */
export const LISTEN_TOKEN_TTL_MS = 60 * 60_000;

/** The one event name on every channel (lib/realtime/client.ts listens for it). */
export const CHANGE_EVENT = 'change';

export function ablyConfigured(): boolean {
  return Boolean(process.env.ABLY_API_KEY);
}

let rest: Ably.Rest | null = null;
let restKey: string | null = null;

function client(): Ably.Rest | null {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;
  if (!rest || restKey !== key) {
    rest = new Ably.Rest({ key });
    restKey = key;
  }
  return rest;
}

/**
 * Publish one hint to one channel. Never throws: a missed hint only means
 * the next poll finds the change instead. `what` only labels the log.
 */
export async function publishHint(channel: string, data: unknown, what: string): Promise<void> {
  const ably = client();
  if (!ably) return;
  await ably.channels
    .get(channel)
    .publish(CHANGE_EVENT, data)
    .catch((error: unknown) => {
      console.error(`[realtime] Couldn’t publish a real-time event to ${what}:`, error);
    });
}

/**
 * A signed, listen-only token request for exactly these channels. The
 * browser exchanges it with Ably for a token; it can't publish, can't read
 * history, and can't attach to any other channel. Signed locally with the
 * key — no network call here. Null when Ably isn't configured.
 */
export async function listenTokenRequest(channels: string[]): Promise<Ably.TokenRequest | null> {
  const ably = client();
  if (!ably || channels.length === 0) return null;
  const capability: Record<string, ['subscribe']> = {};
  for (const name of channels) capability[name] = ['subscribe'];
  return ably.auth.createTokenRequest({ capability, ttl: LISTEN_TOKEN_TTL_MS });
}

/** Tests only: forget the client so a changed key takes effect. */
export function resetAblyClient(): void {
  rest = null;
  restKey = null;
}
