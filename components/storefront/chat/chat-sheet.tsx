'use client';

/*
 * The storefront chat's host (ROADMAP 17.3): one sheet, mounted once by the
 * storefront providers when the shop takes messages, opened from any
 * launcher. Full width on a phone, a side panel from `sm` up — the same
 * frame as the shopping assistant, which is a different thing: this one
 * reaches people at the store.
 *
 * While the panel is closed it checks once a minute whether the store has
 * replied, so the launchers' counts stay true — but only for someone who
 * has a conversation. A shopper who has never written causes no requests.
 * The panel polls for itself while it's open.
 */
import * as React from 'react';
import { MessageCircle } from 'lucide-react';
import { SheetRoot, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useStorefront } from '@/lib/storefront/context';
import { useChatStore } from '@/lib/storefront/stores/chat-store';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import { fetchShopperChat } from '@/lib/storefront/chat-client';
import { useChatConfig, useHasConversation } from './chat-config';
import { ChatPanel } from './chat-panel';

const BACKGROUND_CHECK_MS = 60_000;

export function ChatSheet() {
  const { org } = useStorefront();
  const config = useChatConfig();
  const open = useChatStore((s) => s.open);
  const closeChat = useChatStore((s) => s.closeChat);
  const setStatus = useChatStore((s) => s.setStatus);
  const hasConversation = useHasConversation();

  const lastUnread = React.useRef<number | null>(null);
  const check = React.useCallback(async () => {
    const response = await fetchShopperChat(org.slug, { summary: true });
    const unread = response.conversation?.unread ?? 0;
    setStatus({ unread, hasConversation: Boolean(response.conversation) });
    const changed = lastUnread.current !== null && unread > lastUnread.current;
    lastUnread.current = unread;
    return changed;
  }, [org.slug, setStatus]);

  useChatFeed({
    enabled: Boolean(config) && !open && hasConversation,
    poll: check,
    fastMs: BACKGROUND_CHECK_MS,
    slowMs: BACKGROUND_CHECK_MS,
  });

  if (!config) return null;

  return (
    <SheetRoot open={open} onOpenChange={(next) => !next && closeChat()}>
      <SheetContent side="right" className="safe-top flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircle aria-hidden className="size-4 text-brand" />
            Message {org.name}
          </SheetTitle>
          <SheetDescription>A private conversation with the people who run this shop.</SheetDescription>
        </SheetHeader>
        {/* Mounted only while open: the panel's polling starts and stops with it. */}
        {open && <ChatPanel />}
      </SheetContent>
    </SheetRoot>
  );
}
