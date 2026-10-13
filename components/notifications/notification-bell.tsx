'use client';

/*
 * The notification bell (ROADMAP 18.2), in the admin header and the platform
 * console. One component, pointed at its surface's routes:
 *
 *   /notifications            a member's list, in the shop the host names
 *   /platform/notifications   a platform staff member's
 *
 * The count stays current three ways, cheapest first: an Ably hint carrying
 * the new count (lib/notifications/realtime.ts) while real-time is live; a
 * poll every minute or two otherwise (every five as a backup when live); and
 * a fresh ask whenever the tab comes back. The list itself is only fetched
 * when the dropdown opens. Opening an entry marks it read.
 *
 * While this browser could have alerts but hasn't been asked, the dropdown
 * offers them (ROADMAP 18.3) — the browser's own prompt only ever comes from
 * that click, and "Not now" is remembered on this browser.
 */
import * as React from 'react';
import Link from 'next/link';
import { Bell, BellRing, CheckCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useRealtimeChannel } from '@/lib/realtime/client';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import { formatRelativeTime } from '@/lib/format';
import { isListEvent, unreadBadge, type BellFeed, type ListEvent, type NotificationItem } from '@/lib/notifications/view';
import { dismissOffer, offerDismissed, turnOnWebPush, webPushSupport } from '@/lib/notifications/web-push-client';

const POLL_MS = 60_000;
const POLL_IDLE_MS = 120_000;
/** While real-time is live the poll is only a safety net. */
const BACKUP_POLL_MS = 5 * 60_000;

/** Ask the feed. Throws on failure, which the polling hook counts as one. */
async function askFeed(url: string, body: Record<string, unknown>, keepalive = false): Promise<BellFeed> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    keepalive,
  });
  if (!response.ok) throw new Error(`Notifications feed answered ${response.status}`);
  return (await response.json()) as BellFeed;
}

/** Tell the server an entry was opened. Survives the navigation that follows. */
export function markOpened(feedUrl: string, id: string): void {
  void askFeed(feedUrl, { read: id }, true).catch(() => {});
}

export function NotificationBell({ base, className }: { base: '/notifications' | '/platform/notifications'; className?: string }) {
  const feedUrl = `${base}/feed`;
  const [unread, setUnread] = React.useState(0);
  const [items, setItems] = React.useState<NotificationItem[] | null>(null);
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [open, setOpen] = React.useState(false);
  const openRef = React.useRef(false);
  const unreadRef = React.useRef(0);
  const pollNowRef = React.useRef<() => void>(() => {});

  const apply = React.useCallback((feed: BellFeed) => {
    unreadRef.current = feed.unread;
    setUnread(feed.unread);
    if (feed.items) setItems(feed.items);
  }, []);

  const loadList = React.useCallback(async () => {
    setState((s) => (s === 'error' ? 'loading' : s));
    try {
      apply(await askFeed(feedUrl, { latest: true }));
      setState('idle');
    } catch {
      setState('error');
    }
  }, [apply, feedUrl]);

  const realtime = useRealtimeChannel<ListEvent>({
    enabled: true,
    tokenUrl: `${base}/realtime-token`,
    accept: isListEvent,
    onEvent: (event) => {
      if (event.unread === unreadRef.current) return;
      unreadRef.current = event.unread;
      setUnread(event.unread);
      // Open: show what arrived. Closed: the next opening fetches afresh.
      if (openRef.current) void loadList();
      else setItems(null);
    },
    onCatchUp: () => pollNowRef.current(),
  });

  const poll = React.useCallback(async () => {
    const before = unreadRef.current;
    apply(await askFeed(feedUrl, openRef.current ? { latest: true } : {}));
    return unreadRef.current !== before;
  }, [apply, feedUrl]);

  const live = realtime === 'live';
  const { pollNow } = useChatFeed({
    enabled: true,
    poll,
    fastMs: live ? BACKUP_POLL_MS : POLL_MS,
    slowMs: live ? BACKUP_POLL_MS : POLL_IDLE_MS,
  });
  React.useEffect(() => {
    pollNowRef.current = pollNow;
  }, [pollNow]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    openRef.current = next;
    if (next) {
      if (!items) setState('loading');
      void loadList();
    }
  }

  function opened(item: NotificationItem) {
    if (item.read) return;
    markOpened(feedUrl, item.id);
    setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, read: true } : i)) ?? null);
    unreadRef.current = Math.max(0, unreadRef.current - 1);
    setUnread(unreadRef.current);
  }

  async function markAll() {
    try {
      apply(await askFeed(feedUrl, { readAll: true, latest: true }));
    } catch {
      setState('error');
    }
  }

  const now = new Date();
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <DropdownMenuRoot open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title="Notifications"
          className={cn(
            'relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <Bell className="size-4" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums"
            >
              {unreadBadge(unread)}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={markAll}>
              <CheckCheck aria-hidden />
              Mark all read
            </Button>
          )}
        </div>

        {open && <AlertsOffer route={`${base}/web-push`} dismissKey={base} />}

        <div className="max-h-[22rem] overflow-y-auto p-1">
          {state === 'loading' && !items ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : state === 'error' && !items ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">We couldn’t load your notifications.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadList()}>
                Try again
              </Button>
            </div>
          ) : items && items.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="mt-1 text-xs text-muted-foreground">When something needs you, it shows up here.</p>
            </div>
          ) : (
            items?.map((item) => (
              <DropdownMenuItem key={item.id} asChild={Boolean(item.href)} onSelect={() => opened(item)} className="items-start gap-2.5 px-2 py-2">
                {item.href ? (
                  <Link href={item.href}>
                    <BellEntry item={item} now={now} />
                  </Link>
                ) : (
                  <div>
                    <BellEntry item={item} now={now} />
                  </div>
                )}
              </DropdownMenuItem>
            ))
          )}
        </div>

        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuItem asChild className="justify-center rounded-none py-2.5 text-sm font-medium">
          <Link href={base}>See all notifications</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}

/** "Get alerts on this device", for a browser that can have them and hasn't been asked. */
function AlertsOffer({ route, dismissKey }: { route: string; dismissKey: string }) {
  const [show, setShow] = React.useState(false);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    setShow(webPushSupport() === 'ready' && Notification.permission === 'default' && !offerDismissed(dismissKey));
  }, [dismissKey]);

  if (!show) return null;

  async function turnOn() {
    setWorking(true);
    const result = await turnOnWebPush(route);
    setWorking(false);
    setShow(false);
    if (result === 'on') toast.success('Alerts are on for this browser');
    else if (result === 'blocked') toast.error('This browser blocked notifications for this site.');
    else toast.error('We couldn’t turn alerts on. Please try again.');
  }

  return (
    <div className="flex items-start gap-2.5 border-b bg-muted/40 px-3 py-2.5">
      <BellRing className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Get alerts on this device</p>
        <p className="text-xs text-muted-foreground">Hear about what needs you, even with this tab closed.</p>
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" onClick={() => void turnOn()} disabled={working}>
            {working && <Loader2 className="animate-spin" aria-hidden />}
            Turn on
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              dismissOffer(dismissKey);
              setShow(false);
            }}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

function BellEntry({ item, now }: { item: NotificationItem; now: Date }) {
  return (
    <>
      <span
        aria-hidden
        className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.read ? 'bg-transparent' : 'bg-primary')}
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', item.read ? 'text-muted-foreground' : 'font-medium text-foreground')}>
          {item.title}
          {!item.read && <span className="sr-only"> (unread)</span>}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{item.body}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground/80">{formatRelativeTime(item.createdAt, now)}</span>
      </span>
    </>
  );
}
