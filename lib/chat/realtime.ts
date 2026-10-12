/*
 * lib/chat/realtime.ts
 *
 * The server half of the realtime seam (ROADMAP 17). Every saved change to a
 * conversation is announced here, after it has been committed — and only a
 * change that was actually made: a retried send that returns the message
 * already saved doesn't come through here again (lib/chat/service.ts).
 *
 * With Ably configured (lib/chat/ably.ts), messages and status changes are
 * published as small hints — "conversation X changed, up to #N" — after the
 * response has gone (runAfter), so a send never waits on Ably. Read marks
 * aren't published: nothing on screen depends on another side's read mark
 * arriving instantly (the badge keeps its timer), and each one would be a
 * billed message.
 *
 * Without Ably this does nothing, and browsers keep polling
 * (./use-chat-feed.ts). Either way an event is only ever a hint to fetch;
 * the database is the source of truth, and the fetch that follows reads it
 * with the store's own checks.
 *
 * Never put a message's text in a change: a channel is a cheaper thing to
 * leak than a database.
 */
import { runAfter } from '@/lib/run-after';
import { ablyConfigured, publishChatEvent } from './ably';

export type ChatChange =
  | { kind: 'message'; organizationId: string; conversationId: string; seq: number; sender: 'CUSTOMER' | 'STAFF' }
  | { kind: 'read'; organizationId: string; conversationId: string; side: 'CUSTOMER' | 'STAFF' }
  | { kind: 'status'; organizationId: string; conversationId: string };

export function notifyChatChanged(change: ChatChange): void {
  if (change.kind === 'read' || !ablyConfigured()) return;
  const event =
    change.kind === 'message'
      ? { type: 'message' as const, conversationId: change.conversationId, seq: change.seq, sender: change.sender }
      : { type: 'status' as const, conversationId: change.conversationId };
  runAfter(() => publishChatEvent(change.organizationId, event));
}
