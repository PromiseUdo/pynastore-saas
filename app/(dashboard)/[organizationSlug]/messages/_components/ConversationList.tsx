'use client';

/*
 * The inbox list: views, search, and one row per conversation, newest first.
 *
 * A row is a real link (keyboard, middle-click, "open in new tab" all work)
 * to the same page with `c` set. Unread is a number, not only a dot, and a
 * resolved or blocked conversation says so in words.
 */
import * as React from 'react';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/empty-state';
import { TablePagination } from '@/components/ui/table-pagination';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import { INBOX_VIEWS, INBOX_VIEW_LABEL, type InboxView } from '@/lib/chat/rules';
import type { ConversationRow } from '@/lib/chat/service';

export function ConversationList({
  rows,
  total,
  page,
  pageSize,
  view,
  query,
  selectedId,
  hrefFor,
  setParams,
}: {
  rows: ConversationRow[];
  total: number;
  page: number;
  pageSize: number;
  view: InboxView;
  query: string;
  selectedId: string | null;
  hrefFor: (conversationId: string | null) => string;
  setParams: (patch: Record<string, string | null>) => void;
}) {
  const [search, setSearch] = React.useState(query);
  React.useEffect(() => setSearch(query), [query]);

  // Search as they type, once they pause.
  React.useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => setParams({ q: search.trim() || null }), 350);
    return () => clearTimeout(timer);
  }, [search, query, setParams]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtering = view !== 'all' || query.length > 0;

  return (
    <>
      <div className="space-y-2 border-b px-3 pb-0 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search names, emails or messages"
            aria-label="Search conversations"
            className="h-8 pl-8 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto" aria-label="Views">
          {INBOX_VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              aria-current={view === key ? 'page' : undefined}
              onClick={() => setParams({ view: key === 'all' ? null : key })}
              className={cn(
                'whitespace-nowrap border-b-2 px-2 pb-2 pt-1 text-sm transition-colors',
                view === key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {INBOX_VIEW_LABEL[key]}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="p-3">
            <EmptyState
              variant="filtered"
              title="No conversations found"
              description={filtering ? 'Nothing matches this search or view.' : undefined}
              action={
                filtering ? (
                  <Button variant="outline" size="sm" onClick={() => setParams({ view: null, q: null })}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id}>
                <ConversationLink row={row} href={hrefFor(row.id)} selected={row.id === selectedId} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <div className="border-t px-3 py-2">
          <TablePagination
            page={Math.min(page, totalPages)}
            totalPages={totalPages}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={(next) => setParams({ page: next > 1 ? String(next) : null })}
          />
        </div>
      )}
    </>
  );
}

function ConversationLink({ row, href, selected }: { row: ConversationRow; href: string; selected: boolean }) {
  const unread = row.unread > 0;
  const name = row.name ?? 'Guest';
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex gap-3 px-3 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
        selected && 'bg-muted',
      )}
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm', unread ? 'font-semibold text-foreground' : 'font-medium')}>{name}</span>
          {row.isGuest && row.name && <span className="shrink-0 text-xs text-muted-foreground">Guest</span>}
          <span suppressHydrationWarning className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatRelativeTime(row.lastMessageAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('line-clamp-1 min-w-0 flex-1 text-xs', unread ? 'text-foreground' : 'text-muted-foreground')}>
            {row.lastSender === 'STAFF' && <span className="text-muted-foreground">You: </span>}
            {row.preview}
          </span>
          {unread && (
            <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 tabular-nums text-primary-foreground">
              {row.unread > 99 ? '99+' : row.unread}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </span>
        {(row.blocked || row.status === 'RESOLVED') && (
          <span className="mt-1 flex gap-1">
            {row.blocked && <Badge variant="destructive">Blocked</Badge>}
            {row.status === 'RESOLVED' && <Badge variant="completed">Resolved</Badge>}
          </span>
        )}
      </span>
    </Link>
  );
}
