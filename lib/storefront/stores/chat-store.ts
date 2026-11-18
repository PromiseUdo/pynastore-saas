'use client';

/*
 * The storefront chat's on-screen state (ROADMAP 17.3): whether the panel is
 * open, which product it was opened from, and the unread count every
 * launcher shows. Not persisted — the conversation itself lives in the
 * database and is fetched; this is only what the page is doing right now.
 *
 * `snapshot` is what the panel last showed, kept while the page lives so
 * reopening the panel shows the conversation at once and only asks for
 * what's newer, instead of "Loading your messages…" every time.
 *
 * `unread` and `hasConversation` start null, meaning "nothing newer than
 * what the server rendered"; readers fall back to the layout's values
 * (useChatConfig) until the first answer arrives.
 */
import { create } from 'zustand';
import type { ShopperChatMessage } from '@/lib/chat/rules';
import type { ShopperChatResponse } from '@/lib/storefront/chat-client';

export interface ChatSnapshot {
  /** the store it belongs to */
  org: string;
  /** saved messages only (each has its seq) */
  messages: ShopperChatMessage[];
  conversation: ShopperChatResponse['conversation'];
  hasEarlier: boolean;
  available: boolean;
}

export interface ChatProductContext {
  id: string;
  name: string;
}

interface ChatState {
  open: boolean;
  /** the product page the panel was opened from, until the shopper sends or clears it */
  product: ChatProductContext | null;
  unread: number | null;
  hasConversation: boolean | null;
  snapshot: ChatSnapshot | null;
  openChat: (product?: ChatProductContext | null) => void;
  closeChat: () => void;
  clearProduct: () => void;
  setStatus: (status: { unread: number; hasConversation: boolean }) => void;
  saveSnapshot: (snapshot: ChatSnapshot) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  open: false,
  product: null,
  unread: null,
  hasConversation: null,
  snapshot: null,
  openChat: (product = null) => set({ open: true, product }),
  closeChat: () => set({ open: false }),
  clearProduct: () => set({ product: null }),
  setStatus: ({ unread, hasConversation }) => set({ unread, hasConversation }),
  saveSnapshot: (snapshot) => set({ snapshot }),
}));
