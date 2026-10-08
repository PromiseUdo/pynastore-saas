'use client';

/*
 * Whether this shop takes messages, and what the storefront knew about this
 * shopper's conversation when the page was rendered (ROADMAP 17.3).
 *
 * Provided once by the storefront providers from the layout. `null` means
 * chat is off — or the shop isn't really open — and then every launcher
 * renders nothing.
 */
import * as React from 'react';
import { useChatStore } from '@/lib/storefront/stores/chat-store';

export interface StorefrontChatConfig {
  /** the merchant's own greeting, or null for the panel's fixed line */
  greeting: string | null;
  /** this browser's shopper has written to the store before */
  exists: boolean;
  /** the store's messages they hadn't seen, as of the server render */
  unread: number;
  /** inside this store's own app, which can be reached by push (ROADMAP 17.4) */
  pushReady?: boolean;
}

const ChatConfigContext = React.createContext<StorefrontChatConfig | null>(null);

export function ChatConfigProvider({ value, children }: { value: StorefrontChatConfig | null; children: React.ReactNode }) {
  return <ChatConfigContext.Provider value={value}>{children}</ChatConfigContext.Provider>;
}

/** Null when the shop doesn't take messages. */
export function useChatConfig(): StorefrontChatConfig | null {
  return React.useContext(ChatConfigContext);
}

/** The latest unread count: what the panel last saw, else the server's. */
export function useChatUnread(): number {
  const config = useChatConfig();
  const live = useChatStore((s) => s.unread);
  return config ? (live ?? config.unread) : 0;
}

/** Whether there's a conversation to check on in the background. */
export function useHasConversation(): boolean {
  const config = useChatConfig();
  const live = useChatStore((s) => s.hasConversation);
  return config ? (live ?? config.exists) : false;
}
