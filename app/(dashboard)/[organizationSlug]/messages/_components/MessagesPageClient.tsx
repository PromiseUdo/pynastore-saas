'use client';

/*
 * The Messages page: the conversation list beside the open conversation,
 * with the customer's details as a third column on wide screens.
 *
 * On a phone or a narrow tablet it is one thing at a time: the list, or the
 * conversation with a link back. The URL decides which (`c`), so the
 * browser's back button does what people expect.
 *
 * Live updates: while a conversation is open, ConversationPane polls for its
 * messages; otherwise this polls for the inbox alone. Either way, when the
 * inbox's `changedAt` moves the page refreshes, so the list re-sorts and the
 * counts change without anyone reloading.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, MessagesSquare, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import { fetchFeed, useInboxStore, type ChatProductCardView, type InboxSummaryView } from '@/lib/chat/inbox-client';
import type { InboxView, StaffChatMessage } from '@/lib/chat/rules';
import type { ConversationRow, StaffConversation } from '@/lib/chat/service';
import { ConversationList } from './ConversationList';
import { ConversationPane } from './ConversationPane';

export interface MessagesPermissions {
  reply: boolean;
  viewCustomers: boolean;
  viewOrders: boolean;
  viewProducts: boolean;
  viewSettings: boolean;
}

export interface SelectedConversation {
  conversation: StaffConversation;
  messages: StaffChatMessage[];
  hasEarlier: boolean;
  products: Record<string, ChatProductCardView>;
}

/**
 * Feed the shared unread count, and refresh the server-rendered parts of the
 * page when the inbox has changed since they were rendered.
 */
export function useInboxSync() {
  const router = useRouter();
  const setSummary = useInboxStore((s) => s.setSummary);
  const seen = React.useRef<string | null | undefined>(undefined);
  return React.useCallback(
    (summary: InboxSummaryView) => {
      setSummary(summary);
      if (seen.current !== undefined && summary.changedAt !== seen.current) router.refresh();
      seen.current = summary.changedAt;
    },
    [router, setSummary],
  );
}

export function MessagesPageClient({
  rows,
  total,
  page,
  pageSize,
  view,
  query,
  selectedId,
  selected,
  setup,
  currency,
  can,
}: {
  rows: ConversationRow[];
  total: number;
  page: number;
  pageSize: number;
  view: InboxView;
  query: string;
  selectedId: string | null;
  selected: SelectedConversation | null;
  setup: { enabled: boolean; shopOpen: boolean };
  currency: string;
  can: MessagesPermissions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const syncInbox = useInboxSync();

  /** Change the URL's filters. Anything but the page itself sends you back to page 1. */
  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch) && !('c' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  /** A link to a conversation that keeps the list's filters. */
  const hrefFor = React.useCallback(
    (conversationId: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (conversationId) next.set('c', conversationId);
      else next.delete('c');
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  // With nothing open, keep the list itself current.
  const pollInbox = React.useCallback(async () => {
    const response = await fetchFeed({ inbox: true });
    syncInbox(response.summary);
    return false;
  }, [syncInbox]);
  useChatFeed({ enabled: !selectedId, poll: pollInbox, fastMs: 10_000, slowMs: 30_000 });

  const filtering = view !== 'all' || query.length > 0;
  const nothingYet = total === 0 && !filtering;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Messages"
        description="Private conversations with shoppers from your online store."
        actions={
          can.viewSettings ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/storefront#chat">
                <Settings2 className="size-3.5" />
                Chat settings
              </Link>
            </Button>
          ) : undefined
        }
      />

      {!nothingYet && <ChatOffNotice setup={setup} canViewSettings={can.viewSettings} />}

      {nothingYet ? (
        <div className="px-6 py-10">
          <EmptyState
            icon={MessagesSquare}
            title="No conversations yet"
            description={
              setup.enabled
                ? 'When shoppers message your store, their conversations appear here for you to answer.'
                : 'Turn on chat and shoppers can message your store from your online shop. Their conversations appear here.'
            }
            action={
              !setup.enabled && can.viewSettings ? (
                <Button asChild>
                  <Link href="/settings/storefront#chat">Turn on chat</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className={selectedId ? 'hidden min-h-0 border-r lg:flex lg:flex-col' : 'flex min-h-0 flex-col lg:border-r'}>
            <ConversationList
              rows={rows}
              total={total}
              page={page}
              pageSize={pageSize}
              view={view}
              query={query}
              selectedId={selectedId}
              hrefFor={hrefFor}
              setParams={setParams}
            />
          </div>
          <div className={selectedId ? 'flex min-h-0 flex-col' : 'hidden min-h-0 lg:flex lg:flex-col'}>
            {selected ? (
              <ConversationPane
                key={selected.conversation.id}
                selected={selected}
                backHref={hrefFor(null)}
                currency={currency}
                can={can}
                onSummary={syncInbox}
              />
            ) : selectedId ? (
              <div className="p-6">
                <EmptyState
                  icon={MessagesSquare}
                  title="That conversation isn’t here"
                  description="It may have been removed, or the link is from another store."
                  action={
                    <Button variant="outline" asChild>
                      <Link href={hrefFor(null)}>Back to messages</Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                  icon={MessagesSquare}
                  title="Select a conversation"
                  description="Choose one from the list to read it and reply to the customer."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Why shoppers can't write right now — said once, above the list. */
function ChatOffNotice({ setup, canViewSettings }: { setup: { enabled: boolean; shopOpen: boolean }; canViewSettings: boolean }) {
  if (setup.enabled && setup.shopOpen) return null;
  const message = !setup.enabled
    ? 'Chat is off, so shoppers can’t send new messages. You can still reply to these conversations.'
    : 'Your shop is closed, so the chat isn’t showing to shoppers.';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-6 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span className="min-w-0 flex-1 text-muted-foreground">{message}</span>
      {canViewSettings && (
        <Link
          href={setup.enabled ? '/settings/setup' : '/settings/storefront#chat'}
          className="text-sm font-medium text-primary hover:underline"
        >
          {setup.enabled ? 'Open your shop' : 'Turn on chat'}
        </Link>
      )}
    </div>
  );
}
