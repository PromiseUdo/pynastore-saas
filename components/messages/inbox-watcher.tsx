'use client';

/*
 * Keeps an eye on Messages from every dashboard page (ROADMAP 17.2).
 *
 * Mounted once in the dashboard layout, for members who can see messages.
 * It renders nothing; it keeps three things true:
 *   - the sidebar's unread count (through useInboxStore);
 *   - the browser tab title's "(3) " prefix, so a merchant working in
 *     another tab still sees a shopper is waiting;
 *   - a toast — "New message from Ada" — when one arrives while they're on
 *     another page, with a way straight to it.
 *
 * It asks every 10 seconds (30 after a quiet minute), only while the tab is
 * visible. On the Messages page it stops asking: that page polls for itself
 * and feeds the same store, so there is never more than one poll at a time.
 */
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import { fetchFeed, useInboxStore } from '@/lib/chat/inbox-client';

const BADGE_FAST_MS = 10_000;
const BADGE_SLOW_MS = 30_000;

/** "Messages", "/acme/messages" (during the server render) or "/messages?c=…". */
function isMessagesPath(pathname: string): boolean {
  return /(^|\/)messages(\/|$)/.test(pathname);
}

const later = (a: string | null, b: string | null | undefined) => (!a ? (b ?? null) : !b ? a : a > b ? a : b);

export function InboxWatcher() {
  const pathname = usePathname();
  const router = useRouter();
  const onMessages = isMessagesPath(pathname);
  const summary = useInboxStore((s) => s.summary);
  const setSummary = useInboxStore((s) => s.setSummary);

  /* The newest unread message this member has already been told about —
   * or has seen on the Messages page. Undefined until the first answer, so
   * what's waiting when they sign in is the badge's job, not a toast. */
  const announced = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (onMessages && summary) announced.current = later(announced.current ?? null, summary.latestUnread?.lastMessageAt);
  }, [onMessages, summary]);

  const poll = React.useCallback(async () => {
    const next = await fetchFeed({});
    setSummary(next.summary);
    const latest = next.summary.latestUnread;
    const known = announced.current;
    announced.current = later(known ?? null, latest?.lastMessageAt);
    if (known === undefined || !latest || (known && latest.lastMessageAt <= known)) return false;

    toast(`New message from ${latest.name ?? 'a shopper'}`, {
      action: { label: 'Open', onClick: () => router.push(`/messages?c=${encodeURIComponent(latest.id)}`) },
    });
    return true;
  }, [router, setSummary]);

  useChatFeed({ enabled: !onMessages, poll, fastMs: BADGE_FAST_MS, slowMs: BADGE_SLOW_MS });
  useUnreadTitle(summary?.unreadConversations ?? 0);
  return null;
}

/**
 * "(3) Orders" while three conversations wait. Next sets the title on every
 * navigation, so this watches the head and puts the prefix back.
 */
function useUnreadTitle(count: number) {
  React.useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\)\s/, '');
      const wanted = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(/^\(\d+\+?\)\s/, '');
    };
  }, [count]);
}
