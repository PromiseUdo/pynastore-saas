/*
 * lib/chat/rules.ts
 *
 * What a chat message may be, how a conversation's state is worked out, and
 * how a browser merges what the server sends it (ROADMAP 17). No database and
 * no request, so the shopper's panel, the merchant's Messages page and the
 * server are held to one set of rules and one test file — and client
 * components can import it.
 *
 * Who may send is NOT here: that is a fact about the session, checked in
 * ./service.ts against the store and the shopper, never against the form.
 */
import { STORE_AUTHOR } from '@/lib/storefront/questions/rules';

export const CHAT_MESSAGE_MAX = 2000;
export const GUEST_NAME_MAX = 60;
export const CHAT_GREETING_MAX = 200;
/** How much of the latest message the inbox list shows. */
export const PREVIEW_LENGTH = 140;
/** Messages per page, newest first; older ones load on request. */
export const MESSAGE_PAGE_SIZE = 50;
/** Conversations per page of the inbox list. */
export const CONVERSATION_PAGE_SIZE = 25;

/** How the store is named to shoppers on its replies. Never a staff member's name. */
export const CHAT_STORE_AUTHOR = STORE_AUTHOR;

export type ChatSender = 'CUSTOMER' | 'STAFF';
export type ChatConversationStatus = 'OPEN' | 'RESOLVED';

export type ChatValidation = { ok: true; value: string } | { ok: false; message: string };

/**
 * Check a message either side typed. Plain text: it is rendered as text,
 * never HTML, so nothing here strips markup — it just can't do anything.
 * The ceiling is counted after trimming, like the floor.
 */
export function validateMessage(body: unknown): ChatValidation {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed) return { ok: false, message: 'Write a message first.' };
  if (trimmed.length > CHAT_MESSAGE_MAX) {
    return { ok: false, message: `Messages can be up to ${CHAT_MESSAGE_MAX.toLocaleString('en')} characters.` };
  }
  return { ok: true, value: trimmed };
}

/** A guest's optional name. Blank means "no name", not an error. */
export function normalizeGuestName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, GUEST_NAME_MAX) : null;
}

/** The merchant's greeting. Blank means "use the interface's own line". */
export function validateGreeting(greeting: unknown): ChatValidation | { ok: true; value: null } {
  const trimmed = typeof greeting === 'string' ? greeting.trim() : '';
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > CHAT_GREETING_MAX) {
    return { ok: false, message: `Keep the greeting under ${CHAT_GREETING_MAX} characters.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * The id a browser gives a message before sending it, so a retry or a
 * double-click saves once. A crypto.randomUUID() fits; anything that isn't a
 * short opaque token is refused rather than stored.
 */
export function isValidClientId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

/** The start of a message for the inbox list, on one line. */
export function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_LENGTH ? flat : `${flat.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`;
}

/* ─── State ──────────────────────────────────────────────────────────────── */

/** Messages one side hasn't seen. Each side's own sends move its own mark. */
export function unreadCount(lastSeq: number, readSeq: number): number {
  return Math.max(0, lastSeq - readSeq);
}

/**
 * Whether the store owes a reply. Worked out, not stored: an open
 * conversation whose latest message is the shopper's.
 */
export function isAwaitingReply(c: { status: ChatConversationStatus; lastSender: ChatSender }): boolean {
  return c.status === 'OPEN' && c.lastSender === 'CUSTOMER';
}

/** The merchant's one-line hint of where a conversation stands (AGENTS §5). */
export function conversationHint(c: {
  status: ChatConversationStatus;
  lastSender: ChatSender;
  blocked: boolean;
}): string {
  if (c.blocked) return 'Blocked — this shopper can’t send messages';
  if (c.status === 'RESOLVED') return 'Resolved — reopens if they write again';
  return c.lastSender === 'CUSTOMER' ? 'Awaiting your reply' : 'Waiting for the customer';
}

export const CONVERSATION_STATUS_LABEL: Record<ChatConversationStatus, string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
};

/** The inbox's views, kept in the URL (`?view=`). */
export const INBOX_VIEWS = ['all', 'awaiting', 'resolved'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const INBOX_VIEW_LABEL: Record<InboxView, string> = {
  all: 'All',
  awaiting: 'Awaiting reply',
  resolved: 'Resolved',
};

export function parseInboxView(value: unknown): InboxView {
  return INBOX_VIEWS.includes(value as InboxView) ? (value as InboxView) : 'all';
}

/* ─── What leaves the server ─────────────────────────────────────────────── */

/**
 * A message as the shopper sees it. There is no staff field at all, so a
 * staff member's name can't reach a shopper by forgetting to strip it.
 */
export interface ShopperChatMessage {
  id: string;
  seq: number;
  sender: ChatSender;
  /** "Store team" on the store's messages; null on the shopper's own */
  author: string | null;
  body: string;
  productId: string | null;
  clientId: string;
  /** ISO 8601 */
  createdAt: string;
}

/** A message as the store sees it: who on the team wrote it, when it's theirs. */
export interface StaffChatMessage {
  id: string;
  seq: number;
  sender: ChatSender;
  staffUserId: string | null;
  staffName: string | null;
  body: string;
  productId: string | null;
  clientId: string;
  /** ISO 8601 */
  createdAt: string;
}

/* ─── The browser's copy ─────────────────────────────────────────────────── */

/** A message the browser holds: saved (has a seq) or still on its way. */
export interface ClientMessage {
  clientId: string;
  /** null until the server has saved it */
  seq: number | null;
  /** only on a message that isn't saved yet */
  state?: 'sending' | 'failed';
}

/**
 * Fold what the server sent into what the browser shows.
 *
 * Polls overlap, retry, and can arrive out of order; the send's own reply
 * and the next poll both carry the same message. So: a saved message is
 * kept once per `seq` (the server's copy wins), a pending one disappears the
 * moment its `clientId` comes back saved, saved messages are in `seq` order,
 * and anything still sending or failed stays at the bottom in the order it
 * was typed.
 */
export function mergeMessages<T extends ClientMessage>(current: readonly T[], incoming: readonly T[]): T[] {
  const saved = new Map<number, T>();
  const pending: T[] = [];

  for (const m of current) {
    if (m.seq === null) pending.push(m);
    else saved.set(m.seq, m);
  }
  for (const m of incoming) {
    if (m.seq === null) continue;
    saved.set(m.seq, m);
  }

  const savedClientIds = new Set([...saved.values()].map((m) => m.clientId));
  const stillPending = pending.filter((m) => !savedClientIds.has(m.clientId));
  const ordered = [...saved.values()].sort((a, b) => (a.seq as number) - (b.seq as number));
  return [...ordered, ...stillPending];
}

/**
 * The largest `seq` a request may name. The column is a 4-byte integer, so
 * anything past this would be a database error rather than "nothing newer".
 */
export const MAX_SEQ = 2_147_483_647;

/** A `seq` from a request: a whole number in range, or undefined. */
export function parseSeq(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_SEQ ? n : undefined;
}

/** The highest saved `seq` the browser holds — what the next poll asks "after". */
export function latestSeq(messages: readonly ClientMessage[]): number {
  let max = 0;
  for (const m of messages) if (m.seq !== null && m.seq > max) max = m.seq;
  return max;
}

/** The lowest saved `seq` — what "Load earlier" asks "before". */
export function earliestSeq(messages: readonly ClientMessage[]): number | null {
  let min: number | null = null;
  for (const m of messages) if (m.seq !== null && (min === null || m.seq < min)) min = m.seq;
  return min;
}

/* ─── How often to ask ───────────────────────────────────────────────────── */

/** While someone is looking at a conversation. */
export const POLL_FAST_MS = 3_000;
/** After a minute with nothing new. */
export const POLL_SLOW_MS = 10_000;
export const POLL_IDLE_AFTER_MS = 60_000;
/** The longest wait between retries while the server can't be reached. */
export const POLL_MAX_BACKOFF_MS = 30_000;

/**
 * How long to wait before the next poll. `failures` is how many polls in a
 * row have failed: they back off (doubling, capped) so a dropped connection
 * doesn't become a request every few seconds forever.
 */
export function nextPollDelay(input: {
  sinceActivityMs: number;
  failures: number;
  fastMs?: number;
  slowMs?: number;
}): number {
  const fast = input.fastMs ?? POLL_FAST_MS;
  const slow = input.slowMs ?? POLL_SLOW_MS;
  if (input.failures > 0) {
    // Capped, but never below the caller's own slow interval: a light
    // once-a-minute check must not speed up because it failed.
    return Math.min(Math.max(POLL_MAX_BACKOFF_MS, slow), fast * 2 ** Math.min(input.failures, 4));
  }
  return input.sinceActivityMs >= POLL_IDLE_AFTER_MS ? slow : fast;
}
