/*
 * lib/chat/ably.ts
 *
 * The chat's real-time hint channels, through Ably (server only; the
 * client, tokens and publishing are shared in lib/realtime/ably.ts). The
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
import { publishHint } from '@/lib/realtime/ably';

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
  const targets = [inboxChannelName(organizationId)];
  // The shopper only needs the store's side: its replies and status changes (a block, say).
  if (event.type === 'status' || event.sender === 'STAFF') targets.push(chatChannelName(organizationId, event.conversationId));
  await Promise.all(targets.map((name) => publishHint(name, event, `chat ${name.split(':')[0]}`)));
}
