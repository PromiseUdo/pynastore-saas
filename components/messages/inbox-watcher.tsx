'use client';

/*
 * Keeps an eye on Messages from every dashboard page (ROADMAP 17.2, 18).
 *
 * Mounted once in the dashboard layout, for members who can see messages.
 * It renders nothing; it keeps four things true:
 *   - the sidebar's unread count (through useInboxStore);
 *   - the browser tab's title — "(3) Orders" — so a merchant on another tab
 *     sees a shopper is waiting (lib/notifications/title-badge.ts);
 *   - a soft chime when a new message arrives (lib/notifications/chime.ts);
 *   - a toast — "New message from Ada" — with a way straight to it.
 *
 * It hears about new messages on the inbox's real-time channel (Ably) at
 * once — in a background tab too — and otherwise asks every 10 seconds (30
 * after a quiet minute) while the tab is visible, and once a minute while
 * it's hidden. On the Messages page, while it's on screen, it stops: that
 * page polls for itself and feeds the same store, so there is never more
 * than one poll at a time. Hidden, the Messages page pauses, so this takes
 * over.
 */
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import { fetchFeed, useInboxStore } from '@/lib/chat/inbox-client';
import { useRealtimeChannel } from '@/lib/realtime/client';
import { playChime, prepareChime } from '@/lib/notifications/chime';
import { useTitleCount } from '@/lib/notifications/title-badge';

const BADGE_FAST_MS = 10_000;
const BADGE_SLOW_MS = 30_000;
/** In a background tab browsers allow about one timer a minute anyway. */
const HIDDEN_MS = 60_000;

/** "Messages", "/acme/messages" (during the server render) or "/messages?c=…". */
function isMessagesPath(pathname: string): boolean {
  return /(^|\/)messages(\/|$)/.test(pathname);
}

const later = (a: string | null, b: string | null | undefined) => (!a ? (b ?? null) : !b ? a : a > b ? a : b);

function useTabHidden(): boolean {
  const [hidden, setHidden] = React.useState(false);
  React.useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

export function InboxWatcher() {
  const pathname = usePathname();
  const router = useRouter();
  const hidden = useTabHidden();
  const onMessages = isMessagesPath(pathname);
  // On the Messages page, only while that tab is in the background.
  const watching = !onMessages || hidden;
  const summary = useInboxStore((s) => s.summary);
  const setSummary = useInboxStore((s) => s.setSummary);

  /* The newest unread message this member has already been told about —
   * or has seen on the Messages page. Undefined until the first answer, so
   * what's waiting when they sign in is the badge's job, not a toast. */
  const announced = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (onMessages && !hidden && summary) announced.current = later(announced.current ?? null, summary.latestUnread?.lastMessageAt);
  }, [onMessages, hidden, summary]);

  React.useEffect(() => prepareChime(), []);

  const poll = React.useCallback(async () => {
    const next = await fetchFeed({});
    setSummary(next.summary);
    const latest = next.summary.latestUnread;
    const known = announced.current;
    announced.current = later(known ?? null, latest?.lastMessageAt);
    if (known === undefined || !latest || (known && latest.lastMessageAt <= known)) return false;

    playChime();
    toast(`New message from ${latest.name ?? 'a shopper'}`, {
      action: { label: 'Open', onClick: () => router.push(`/messages?c=${encodeURIComponent(latest.id)}`) },
    });
    return true;
  }, [router, setSummary]);

  // A shopper's message, the moment it's sent — in a background tab too.
  const pollRef = React.useRef(poll);
  React.useEffect(() => {
    pollRef.current = poll;
  }, [poll]);
  const realtime = useRealtimeChannel({
    enabled: watching,
    tokenUrl: '/messages/realtime-token',
    onEvent: (event) => {
      if (event.type === 'message' && event.sender === 'CUSTOMER') void pollRef.current().catch(() => {});
    },
    onCatchUp: () => void pollRef.current().catch(() => {}),
  });

  useChatFeed({
    enabled: watching,
    poll,
    fastMs: BADGE_FAST_MS,
    slowMs: BADGE_SLOW_MS,
    hiddenMs: realtime === 'live' ? undefined : HIDDEN_MS,
  });
  useTitleCount('messages', summary?.unreadConversations ?? 0);
  return null;
}
