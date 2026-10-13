'use client';

/*
 * A shopper's notification list (ROADMAP 18.2), in the storefront's own
 * look. Opening an entry marks it read (a server action, so it survives the
 * navigation that follows); "Mark all as read" clears the lot.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/storefront/format';
import { markAllNotificationsReadAction, openNotificationAction } from '@/features/shop-account/notification-actions';
import type { NotificationItem, NotificationPage } from '@/lib/notifications/view';

export function ShopperNotificationList({ data }: { data: NotificationPage }) {
  const router = useRouter();
  const [opened, setOpened] = React.useState<Set<string>>(() => new Set());
  const [pending, startTransition] = React.useTransition();
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  function open(item: NotificationItem) {
    if (item.read || opened.has(item.id)) return;
    setOpened((set) => new Set(set).add(item.id));
    void openNotificationAction(item.id).catch(() => {});
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction().catch(() => false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {data.unread > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={markAll}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-[var(--sf-radius-button,999px)] border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Mark all as read
          </button>
        </div>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {data.items.map((item) => {
          const read = item.read || opened.has(item.id);
          const inner = (
            <>
              <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', read ? 'bg-transparent' : 'bg-brand')} />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', read ? 'text-muted-foreground' : 'font-semibold')}>
                  {item.body}
                  {!read && <span className="sr-only"> (unread)</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
              </span>
              {item.href && <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            </>
          );
          const rowClass = 'flex min-h-14 items-start gap-3 px-4 py-3 text-left';
          return (
            <li key={item.id}>
              {item.href ? (
                <Link href={item.href} onClick={() => open(item)} className={cn(rowClass, 'transition-colors hover:bg-accent')}>
                  {inner}
                </Link>
              ) : (
                <button type="button" onClick={() => open(item)} className={cn(rowClass, 'w-full')}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {data.page > 1 ? (
            <Link href={`/account/notifications?page=${data.page - 1}`} className="inline-flex h-10 items-center gap-1 font-medium hover:text-brand">
              <ChevronLeft className="size-4" aria-hidden /> Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground tabular-nums">
            Page {data.page} of {pages}
          </span>
          {data.page < pages ? (
            <Link href={`/account/notifications?page=${data.page + 1}`} className="inline-flex h-10 items-center gap-1 font-medium hover:text-brand">
              Older <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
