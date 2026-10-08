'use client';

/*
 * The storefront chat's on-screen state (ROADMAP 17.3): whether the panel is
 * open, which product it was opened from, and the unread count every
 * launcher shows. Not persisted — the conversation itself lives in the
 * database and is fetched; this is only what the page is doing right now.
 *
 * `unread` and `hasConversation` start null, meaning "nothing newer than
 * what the server rendered"; readers fall back to the layout's values
 * (useChatConfig) until the first answer arrives.
 */
import { create } from 'zustand';

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
  openChat: (product?: ChatProductContext | null) => void;
  closeChat: () => void;
  clearProduct: () => void;
  setStatus: (status: { unread: number; hasConversation: boolean }) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  open: false,
  product: null,
  unread: null,
  hasConversation: null,
  openChat: (product = null) => set({ open: true, product }),
  closeChat: () => set({ open: false }),
  clearProduct: () => set({ product: null }),
  setStatus: ({ unread, hasConversation }) => set({ unread, hasConversation }),
}));
