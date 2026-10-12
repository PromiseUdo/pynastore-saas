/*
 * lib/chat/ably.ts
 *
 * The chat's real-time hint channel, through Ably (server only). The
 * database stays the only source of truth: an event says "conversation X
 * changed, up to message #N" and never carries what anyone wrote — a client
 * that hears one fetches through the same routes polling uses.
 *
 * Two kinds of channel, both named here from server data only:
 *
 *   chat:{organizationId}:{conversationId}   one shopper's conversation —
 *                                            the store's messages and status
 *   inbox:{organizationId}                   a store's whole inbox, for its
 *                                            staff's Messages page
 *
 * Browsers get listen-only (`subscribe`) tokens for exact channel names —
 * never a wildcard, never `publish` — through the two token routes, which
 * decide the channel from who is asking. The API key never leaves the server.
 *
 * Without ABLY_API_KEY nothing here does anything: no events, no tokens, and
 * every chat screen keeps polling as before.
 */
import * as Ably from 'ably';

/** How long a browser's listen token lasts; the SDK renews it before then (authCallback). */
export const LISTEN_TOKEN_TTL_MS = 60 * 60_000;

/** The one event name on every chat channel. */
export const CHAT_EVENT = 'change';

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

export function chatChannelName(organizationId: string, conversationId: string): string {
  return `chat:${organizationId}:${conversationId}`;
}

export function inboxChannelName(organizationId: string): string {
  return `inbox:${organizationId}`;
}

/** What a browser hears. No message text, by design. */
export type ChatEvent =
  | { type: 'message'; conversationId: string; seq: number; sender: 'CUSTOMER' | 'STAFF' }
  | { type: 'status'; conversationId: string };

/**
 * Publish one event to the channels that should hear it. Never throws: a
 * missed event only means the next poll finds the message instead.
 */
export async function publishChatEvent(organizationId: string, event: ChatEvent): Promise<void> {
  const ably = client();
  if (!ably) return;
  const targets = [inboxChannelName(organizationId)];
  // The shopper only needs the store's side: its replies and status changes (a block, say).
  if (event.type === 'status' || event.sender === 'STAFF') targets.push(chatChannelName(organizationId, event.conversationId));
  await Promise.all(
    targets.map((name) =>
      ably.channels
        .get(name)
        .publish(CHAT_EVENT, event)
        .catch((error: unknown) => {
          console.error(`[chat] Couldn’t publish a real-time event to ${name.split(':')[0]}:`, error);
        }),
    ),
  );
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
