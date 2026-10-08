'use client';

/*
 * One conversation: the messages, the reply box, and what can be done with
 * it (resolve, reopen, block).
 *
 * It polls the feed every 3 seconds while it's on screen and the tab is
 * visible, merging by `seq` (mergeMessages), so overlapping polls, a reply's
 * own answer and a refresh never show a message twice or out of order.
 * Each poll also tells the server how far the member has read.
 *
 * A reply appears at once as "Sending…". If it fails it stays, marked "Not
 * sent", with Try again (same clientId, so it can't double-post) and Edit
 * (back into the box) — what was typed is never thrown away.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Send,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { SheetRoot, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatDate, formatTime } from '@/lib/format';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import { fetchFeed, type ChatProductCardView, type InboxSummaryView } from '@/lib/chat/inbox-client';
import {
  CHAT_MESSAGE_MAX,
  conversationHint,
  earliestSeq,
  latestSeq,
  mergeMessages,
  validateMessage,
  type StaffChatMessage,
} from '@/lib/chat/rules';
import {
  blockConversation,
  reopenConversation,
  resolveConversation,
  sendReply,
  unblockConversation,
} from '@/features/messages/actions';
import { CustomerPanel, ProductCard } from './CustomerPanel';
import type { MessagesPermissions, SelectedConversation } from './MessagesPageClient';

/** A message on screen: saved (has a seq) or still on its way. */
type PaneMessage = Omit<StaffChatMessage, 'seq' | 'id'> & {
  id: string | null;
  seq: number | null;
  state?: 'sending' | 'failed';
  error?: string;
};

const fromServer = (m: StaffChatMessage): PaneMessage => m;

/** How close to the bottom counts as "reading the latest". */
const NEAR_BOTTOM_PX = 120;

function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ConversationPane({
  selected,
  backHref,
  currency,
  can,
  onSummary,
}: {
  selected: SelectedConversation;
  backHref: string;
  currency: string;
  can: MessagesPermissions;
  onSummary: (summary: InboxSummaryView) => void;
}) {
  const router = useRouter();
  const { conversation } = selected;
  const name = conversation.name ?? 'Guest';

  const [messages, setMessages] = React.useState<PaneMessage[]>(() => selected.messages.map(fromServer));
  const [products, setProducts] = React.useState(selected.products);
  const [hasEarlier, setHasEarlier] = React.useState(selected.hasEarlier);
  const [loadingEarlier, setLoadingEarlier] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [busy, setBusy] = React.useState<null | 'status' | 'block'>(null);
  const [confirmBlock, setConfirmBlock] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  const messagesRef = React.useRef(messages);
  React.useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // A refresh of the page (the inbox changed) brings the server's latest page — fold it in.
  React.useEffect(() => {
    setMessages((current) => mergeMessages(current, selected.messages.map(fromServer)));
    setProducts((current) => ({ ...current, ...selected.products }));
  }, [selected.messages, selected.products]);

  /* ── Polling ─────────────────────────────────────────────────────────── */

  const poll = React.useCallback(async () => {
    const shown = latestSeq(messagesRef.current);
    const response = await fetchFeed({
      conversationId: conversation.id,
      after: shown,
      read: can.reply ? shown : undefined,
      inbox: true,
    });
    onSummary(response.summary);
    if (response.missing) {
      router.refresh();
      return false;
    }
    const incoming = (response.messages ?? []).map(fromServer);
    if (response.products) setProducts((current) => ({ ...current, ...response.products }));
    if (incoming.length === 0) return false;
    setMessages((current) => mergeMessages(current, incoming));
    return true;
  }, [conversation.id, can.reply, onSummary, router]);

  const { status: feedStatus, pollNow } = useChatFeed({ enabled: true, poll });

  /* ── Scrolling ───────────────────────────────────────────────────────── */

  const scroller = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);
  const keepOffset = React.useRef<number | null>(null);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      // "Load earlier" put messages above: keep the one being read still.
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function loadEarlier() {
    const before = earliestSeq(messagesRef.current);
    if (before === null) return;
    setLoadingEarlier(true);
    try {
      const response = await fetchFeed({ conversationId: conversation.id, before });
      onSummary(response.summary);
      const el = scroller.current;
      if (el) keepOffset.current = el.scrollHeight - el.scrollTop;
      setMessages((current) => mergeMessages(current, (response.messages ?? []).map(fromServer)));
      if (response.products) setProducts((current) => ({ ...current, ...response.products }));
      setHasEarlier(Boolean(response.hasEarlier));
    } catch {
      toast.error('We couldn’t load earlier messages. Please try again.');
    } finally {
      setLoadingEarlier(false);
    }
  }

  /* ── Sending ─────────────────────────────────────────────────────────── */

  async function deliver(clientId: string, body: string) {
    setSending(true);
    setMessages((current) =>
      current.map((m) => (m.clientId === clientId ? { ...m, state: 'sending', error: undefined } : m)),
    );
    const result = await sendReply({ conversationId: conversation.id, clientId, body });
    setSending(false);
    if (!result.success) {
      setMessages((current) =>
        current.map((m) => (m.clientId === clientId ? { ...m, state: 'failed', error: result.error } : m)),
      );
      return;
    }
    setMessages((current) => mergeMessages(current, [fromServer(result.data.message)]));
    pollNow();
  }

  function send() {
    if (sending) return;
    const checked = validateMessage(draft);
    if (!checked.ok) {
      toast.error(checked.message);
      return;
    }
    const clientId = newClientId();
    stickToBottom.current = true;
    setMessages((current) => [
      ...current,
      {
        id: null,
        seq: null,
        clientId,
        sender: 'STAFF',
        staffUserId: null,
        staffName: null,
        body: checked.value,
        productId: null,
        createdAt: new Date().toISOString(),
        state: 'sending',
      },
    ]);
    setDraft('');
    void deliver(clientId, checked.value);
  }

  function editFailed(message: PaneMessage) {
    setMessages((current) => current.filter((m) => m.clientId !== message.clientId));
    setDraft((current) => (current ? `${message.body}\n${current}` : message.body));
  }

  /* ── Status ──────────────────────────────────────────────────────────── */

  async function changeStatus(kind: 'resolve' | 'reopen' | 'block' | 'unblock') {
    setBusy(kind === 'block' || kind === 'unblock' ? 'block' : 'status');
    const action = { resolve: resolveConversation, reopen: reopenConversation, block: blockConversation, unblock: unblockConversation }[kind];
    const result = await action(conversation.id);
    setBusy(null);
    setConfirmBlock(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      {
        resolve: 'Marked as resolved — it reopens if they write again',
        reopen: 'Conversation reopened',
        block: `${name} can no longer send you messages`,
        unblock: `${name} can send you messages again`,
      }[kind],
    );
    router.refresh();
  }

  const resolved = conversation.status === 'RESOLVED';
  const latestProduct = conversation.latestProductId ? (products[conversation.latestProductId] ?? null) : null;
  const overLimit = draft.trim().length > CHAT_MESSAGE_MAX;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-6">
          <Link
            href={backHref}
            scroll={false}
            className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Back to all messages"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{name}</h2>
              {conversation.isGuest && <Badge variant="muted">Guest</Badge>}
              {conversation.blocked ? (
                <Badge variant="destructive">Blocked</Badge>
              ) : resolved ? (
                <Badge variant="completed">Resolved</Badge>
              ) : (
                <Badge variant="info">Open</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{conversationHint(conversation)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="xl:hidden"
              onClick={() => setDetailsOpen(true)}
            >
              <UserRound className="size-3.5" />
              Customer details
            </Button>
            {can.reply && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => changeStatus(resolved ? 'reopen' : 'resolve')}
                >
                  {busy === 'status' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : resolved ? (
                    <RotateCcw className="size-3.5" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  {resolved ? 'Reopen' : 'Resolve'}
                </Button>
                <DropdownMenuRoot>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="More actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {conversation.blocked ? (
                      <DropdownMenuItem onSelect={() => changeStatus('unblock')}>
                        <Ban className="size-4" />
                        Unblock this shopper
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => setConfirmBlock(true)} className="text-destructive focus:text-destructive">
                        <Ban className="size-4" />
                        Block this shopper
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenuRoot>
              </>
            )}
          </div>
        </div>

        {conversation.blocked && (
          <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:px-6">
            You’ve blocked this shopper, so they can’t send you messages. You can still reply.
          </div>
        )}
        {feedStatus === 'reconnecting' && (
          <div role="status" className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 sm:px-6">
            <WifiOff className="size-3.5" aria-hidden />
            Reconnecting… new messages will appear when we’re back.
          </div>
        )}

        {/* ── Messages ─────────────────────────────────────────────────── */}
        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {hasEarlier && (
            <div className="mb-4 flex justify-center">
              <Button variant="outline" size="sm" onClick={loadEarlier} disabled={loadingEarlier}>
                {loadingEarlier && <Loader2 className="size-3.5 animate-spin" />}
                Load earlier messages
              </Button>
            </div>
          )}
          <ol role="log" aria-live="polite" aria-label={`Conversation with ${name}`} className="space-y-3">
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const day = formatDate(message.createdAt);
              const newDay = !previous || formatDate(previous.createdAt) !== day;
              const product = message.productId ? products[message.productId] : undefined;
              return (
                <li key={message.clientId}>
                  {newDay && (
                    <p className="my-3 text-center text-xs font-medium text-muted-foreground">{day}</p>
                  )}
                  <MessageBubble
                    message={message}
                    customerName={name}
                    product={product}
                    currency={currency}
                    can={can}
                    onRetry={() => deliver(message.clientId, message.body)}
                    onEdit={() => editFailed(message)}
                  />
                </li>
              );
            })}
          </ol>
        </div>

        {/* ── Reply ────────────────────────────────────────────────────── */}
        <div className="border-t px-4 py-3 sm:px-6">
          {can.reply ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <label htmlFor="chat-reply" className="text-xs font-medium text-muted-foreground">
                Your reply to {name}
              </label>
              <div className="mt-1 flex items-end gap-2">
                <Textarea
                  id="chat-reply"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  rows={Math.min(6, Math.max(1, draft.split('\n').length))}
                  placeholder="Type a reply…"
                  aria-invalid={overLimit || undefined}
                  className="min-h-9 py-2"
                />
                <Button type="submit" size="lg" disabled={sending || !draft.trim() || overLimit}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send reply
                </Button>
              </div>
              <p className={cn('mt-1 text-xs', overLimit ? 'text-destructive' : 'text-muted-foreground')}>
                {overLimit
                  ? `Too long by ${draft.trim().length - CHAT_MESSAGE_MAX} characters.`
                  : 'Enter to send, Shift + Enter for a new line. The shopper sees it as “Store team”.'}
              </p>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">
              You can read messages but not reply. Ask an Owner or Admin for the “Reply to shoppers” permission.
            </p>
          )}
        </div>
      </div>

      {/* ── Customer details: a column on wide screens, a sheet below ──── */}
      <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l p-5 xl:block">
        <CustomerPanel conversation={conversation} product={latestProduct} currency={currency} can={can} />
      </aside>
      <SheetRoot open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Customer details</SheetTitle>
            <SheetDescription>Who you’re talking to, and what about.</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-6 pb-6">
            <CustomerPanel conversation={conversation} product={latestProduct} currency={currency} can={can} />
          </div>
        </SheetContent>
      </SheetRoot>

      <AlertDialogRoot open={confirmBlock} onOpenChange={setConfirmBlock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They won’t be able to send you any more messages. This conversation stays here, and you can still reply or
              unblock them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'block'}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy === 'block'} onClick={() => changeStatus('block')}>
              {busy === 'block' && <Loader2 className="size-3.5 animate-spin" />}
              Block shopper
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}

function MessageBubble({
  message,
  customerName,
  product,
  currency,
  can,
  onRetry,
  onEdit,
}: {
  message: PaneMessage;
  customerName: string;
  product: ChatProductCardView | undefined;
  currency: string;
  can: MessagesPermissions;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const mine = message.sender === 'STAFF';
  const author = mine ? (message.staffName ?? 'You') : customerName;
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {product && (
        <div className="mb-1">
          <p className="mb-1 text-xs text-muted-foreground">Sent from this product</p>
          <ProductCard product={product} currency={currency} linkable={can.viewProducts} />
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm sm:max-w-[70%]',
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
          message.state === 'sending' && 'opacity-70',
          message.state === 'failed' && 'opacity-60',
        )}
      >
        {message.body}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {message.state === 'sending' ? (
          'Sending…'
        ) : message.state === 'failed' ? (
          <span className="text-destructive">
            Not sent{message.error ? ` — ${message.error}` : ''}
            {' · '}
            <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
              Try again
            </button>
            {' · '}
            <button type="button" onClick={onEdit} className="font-medium underline underline-offset-2">
              Edit
            </button>
          </span>
        ) : (
          <>
            {author} · <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </>
        )}
      </p>
    </div>
  );
}
