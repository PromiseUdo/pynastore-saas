'use client';

/*
 * The /chat page's body (ROADMAP 17.4): opens the chat as soon as the page
 * is shown, and offers to open it again once it's closed. Says plainly when
 * the shop doesn't take messages.
 */
import * as React from 'react';
import Link from 'next/link';
import { useChatStore } from '@/lib/storefront/stores/chat-store';
import { useChatConfig } from './chat-config';
import { ChatLauncher } from './chat-launcher';

export function ChatPageOpener() {
  const config = useChatConfig();
  const openChat = useChatStore((s) => s.openChat);

  React.useEffect(() => {
    if (config) openChat(null);
  }, [config, openChat]);

  if (!config) {
    return (
      <div className="text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-2 text-sm text-muted-foreground">This shop isn’t taking messages right now.</p>
        <Link href="/" className="mt-5 inline-flex text-sm font-semibold text-brand hover:underline">
          Back to the shop
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Messages</h1>
      <ChatLauncher variant="row" />
      <Link href="/" className="inline-flex text-sm font-semibold text-brand hover:underline">
        Back to the shop
      </Link>
    </div>
  );
}
