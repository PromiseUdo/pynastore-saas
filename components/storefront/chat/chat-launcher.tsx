'use client';

/*
 * The ways into the storefront chat (ROADMAP 17.3). Each renders nothing
 * when the shop doesn't take messages.
 *
 *   floating  desktop only (`lg` and up), in the bottom-right corner the
 *             assistant's floating button uses — sliding up for the
 *             back-to-top arrow the same way (`.sf-assistant-fab`). Hidden
 *             on the bag and at checkout, where the corner belongs to the
 *             order. Phones never get one: the tab bar is full and a button
 *             over the shop is worse than one tap into Account.
 *   row       the phone's Account screen, right under the greeting.
 *   button    the product page — opens the chat about that product.
 *
 * Unread is said in words for screen readers, not only as a number.
 */
import * as React from 'react';
import { ChevronRight, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePageScrolled } from '@/lib/storefront/use-page-scrolled';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { useChatStore, type ChatProductContext } from '@/lib/storefront/stores/chat-store';
import { useChatConfig, useChatUnread } from './chat-config';

/** Pages where the bottom corner belongs to the order, not to chat. */
function isOrderPath(pathname: string): boolean {
  return pathname === '/cart' || pathname.startsWith('/checkout');
}

function UnreadCount({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
      <span className="sr-only"> unread {count === 1 ? 'reply' : 'replies'}</span>
    </span>
  );
}

export function ChatLauncher({
  variant,
  product,
  className,
}: {
  variant: 'floating' | 'row' | 'button';
  product?: ChatProductContext;
  className?: string;
}) {
  const config = useChatConfig();
  const unread = useChatUnread();
  const openChat = useChatStore((s) => s.openChat);
  const scrolled = usePageScrolled();
  const pathname = usePublicPathname();

  if (!config) return null;

  if (variant === 'floating') {
    if (isOrderPath(pathname)) return null;
    return (
      <button
        type="button"
        onClick={() => openChat(null)}
        data-lifted={scrolled ? 'true' : undefined}
        className={cn(
          /* `sf-assistant-fab` owns the vertical position (storefront.css). */
          'sf-assistant-fab fixed right-6 z-30 hidden h-12 items-center gap-2 rounded-[var(--sf-radius-button,999px)] bg-brand px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-foreground/15 transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:inline-flex',
          className,
        )}
      >
        <MessageCircle aria-hidden className="size-4" />
        Message us
        <UnreadCount count={unread} className="bg-primary-foreground text-brand" />
      </button>
    );
  }

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={() => openChat(null)}
        className={cn(
          'flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent',
          className,
        )}
      >
        <MessageCircle aria-hidden className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Message the store</span>
          <span className="block text-xs text-muted-foreground">
            {unread > 0 ? 'The store has replied' : 'Ask about a product, delivery or your order'}
          </span>
        </span>
        <UnreadCount count={unread} />
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openChat(product ?? null)}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-[var(--sf-radius-button,999px)] border bg-card px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <MessageCircle aria-hidden className="size-4 text-brand" />
      Message the store about this
      <UnreadCount count={unread} />
    </button>
  );
}
