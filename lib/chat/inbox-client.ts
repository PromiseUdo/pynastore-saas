'use client';

/*
 * lib/chat/inbox-client.ts
 *
 * The admin's browser side of Messages (ROADMAP 17.2): one call to the feed
 * route, and one small store for the unread count, so the sidebar badge, the
 * tab title and the Messages page show the same number from whichever of
 * them asked last.
 */
import { create } from 'zustand';
import type { StaffChatMessage } from './rules';

/** Mirrors InboxSummary in ./service.ts (server-only, so not imported here). */
export interface InboxSummaryView {
  unreadConversations: number;
  changedAt: string | null;
  latestUnread: { id: string; name: string | null; lastMessageAt: string } | null;
}

/** Mirrors ChatProductCard in ./service.ts. */
export interface ChatProductCardView {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
}

export interface FeedResponse {
  summary: InboxSummaryView;
  /** the conversation asked about is gone, or isn't this store's */
  missing?: boolean;
  messages?: StaffChatMessage[];
  hasEarlier?: boolean | null;
  lastSeq?: number;
  products?: Record<string, ChatProductCardView>;
}

export interface FeedRequest {
  conversationId?: string;
  after?: number;
  before?: number;
  read?: number;
  inbox?: boolean;
}

export class FeedError extends Error {
  constructor(public status: number) {
    super(`Messages feed answered ${status}`);
  }
}

/** Ask the feed. Throws on any failure, which the polling hook counts as one. */
export async function fetchFeed(request: FeedRequest): Promise<FeedResponse> {
  const response = await fetch('/messages/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    cache: 'no-store',
  });
  if (!response.ok) throw new FeedError(response.status);
  return (await response.json()) as FeedResponse;
}

interface InboxState {
  summary: InboxSummaryView | null;
  setSummary: (summary: InboxSummaryView) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  summary: null,
  setSummary: (summary) => set({ summary }),
}));
