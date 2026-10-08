/*
 * lib/chat/realtime.ts
 *
 * The server half of the realtime seam (ROADMAP 17). Every saved change to a
 * conversation is announced here, after it has been committed.
 *
 * Today this does nothing: browsers poll for "anything after #N?"
 * (./use-chat-feed.ts), because the host can't hold a socket and there is no
 * Redis to carry an event between instances. When polling stops being enough,
 * this is where a hosted service (Pusher, Ably) gets told — and the client
 * hook swaps its timer for a subscription. Nothing else changes: the database
 * stays the source of truth and an event is only ever a hint to fetch.
 *
 * Never put a message's text in a change: a channel is a cheaper thing to
 * leak than a database, and the fetch that follows reads it with the store's
 * own checks.
 */

export type ChatChange =
  | { kind: 'message'; organizationId: string; conversationId: string; seq: number; sender: 'CUSTOMER' | 'STAFF' }
  | { kind: 'read'; organizationId: string; conversationId: string; side: 'CUSTOMER' | 'STAFF' }
  | { kind: 'status'; organizationId: string; conversationId: string };

export function notifyChatChanged(change: ChatChange): void {
  void change;
}
