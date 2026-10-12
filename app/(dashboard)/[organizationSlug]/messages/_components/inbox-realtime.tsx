'use client';

/*
 * The Messages page's one real-time connection, shared (see
 * MessagesPageClient, which owns it, and ConversationPane, which listens).
 */
import * as React from 'react';
import type { ChatEventView, RealtimeState } from '@/lib/chat/realtime-client';

/**
 * How often the Messages page still polls while real-time is live. Each poll
 * also tells the server someone has Messages open (touchInboxSeen), which
 * keeps the unanswered-message email quiet (INBOX_WATCHING_MS, 2 minutes).
 */
export const ADMIN_BACKUP_POLL_MS = 30_000;

/**
 * The page's one real-time connection, shared: the open conversation listens
 * through this rather than opening its own.
 */
export interface InboxRealtime {
  state: RealtimeState;
  /** returns the unsubscribe */
  subscribe: (listener: (event: ChatEventView | null) => void) => () => void;
}

export const InboxRealtimeContext = React.createContext<InboxRealtime>({ state: 'off', subscribe: () => () => {} });

/** Events (or `null`: "you may have missed some — catch up") for the store's inbox. */
export function useInboxRealtime(): InboxRealtime {
  return React.useContext(InboxRealtimeContext);
}
