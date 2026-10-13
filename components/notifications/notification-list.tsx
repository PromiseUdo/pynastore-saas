'use client';

/*
 * The full notification list (ROADMAP 18.2): /notifications in the admin and
 * /platform/notifications in the console. The server reads the page asked
 * for in the URL (`show=unread`, `page`) — nothing is filtered here — and
 * this only shows it, marks entries read as they're opened, and clears the
 * lot with "Mark all read".
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, CheckCheck, Loader2, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { PageTabs } from '@/components/layout/page-tabs';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { formatDate, formatRelativeTime } from '@/lib/format';
import type { NotificationItem, NotificationPage } from '@/lib/notifications/view';
import { markOpened } from './notification-bell';

export function NotificationList({
  data,
  base,
  unreadOnly,
  description,
  settingsHref,
}: {
  data: NotificationPage;
  base: '/notifications' | '/platform/notifications';
  unreadOnly: boolean;
  description: string;
  /** where this person turns on alerts for their devices */
  settingsHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [marking, setMarking] = React.useState(false);
  const [opened, setOpened] = React.useState<Set<string>>(() => new Set());
  const now = React.useMemo(() => new Date(), []);

  async function markAll() {
    setMarking(true);
    try {
      const response = await fetch(`${base}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readAll: true }),
      });
      if (!response.ok) throw new Error(String(response.status));
      toast.success('All notifications marked as read');
      router.refresh();
    } catch {
      toast.error('We couldn’t mark them as read. Please try again.');
    } finally {
      setMarking(false);
    }
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (page <= 1) next.delete('page');
    else next.set('page', String(page));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function open(item: NotificationItem) {
    if (item.read || opened.has(item.id)) return;
    markOpened(`${base}/feed`, item.id);
    setOpened((set) => new Set(set).add(item.id));
  }

  const header = (
    <PageHeader
      title="Notifications"
      description={description}
      actions={
        <>
          <Button asChild variant="ghost" size="sm">
            <Link href={settingsHref}>
              <Settings2 aria-hidden />
              Settings
            </Link>
          </Button>
          {data.unread > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={markAll} disabled={marking}>
              {marking ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />}
              Mark all read
            </Button>
          )}
        </>
      }
    />
  );

  if (!data.any) {
    return (
      <div>
        {header}
        <PageBody>
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="When something needs you — a new order, a message, stock running low — it shows up here, and on the bell at the top of the page."
          />
        </PageBody>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div>
      {header}
      <PageToolbar>
        <PageTabs
          param="show"
          current={unreadOnly ? 'unread' : 'all'}
          tabs={[
            { key: 'all', label: 'All' },
            { key: 'unread', label: data.unread > 0 ? `Unread (${data.unread})` : 'Unread' },
          ]}
        />
      </PageToolbar>
      <PageBody>
        {data.items.length === 0 ? (
          <EmptyState
            variant="filtered"
            icon={CheckCheck}
            title="You’re all caught up"
            description="Nothing unread. Everything you’ve already seen is under All."
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => router.replace(pathname)}>
                Show all
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <ul className="divide-y">
              {data.items.map((item) => {
                const read = item.read || opened.has(item.id);
                const body = (
                  <>
                    <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', read ? 'bg-transparent' : 'bg-primary')} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', read ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                        {item.title}
                        {!read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>
                    </span>
                    <time dateTime={item.createdAt} title={formatDate(item.createdAt)} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatRelativeTime(item.createdAt, now)}
                    </time>
                  </>
                );
                const rowClass = 'flex items-start gap-3 px-4 py-3 transition-colors';
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        onClick={() => open(item)}
                        className={cn(rowClass, 'hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none')}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => open(item)} className={cn(rowClass, 'w-full text-left hover:bg-muted/50')}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 && (
              <TablePagination page={data.page} totalPages={totalPages} totalItems={data.total} pageSize={data.pageSize} onPageChange={goToPage} />
            )}
          </div>
        )}
      </PageBody>
    </div>
  );
}
