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
 *
 * A reply can carry one photo (the words are then optional), uploaded
 * straight to Cloudinary when sent; photos either side sent are kept
 * CHAT_PHOTO_DAYS, after which the message says the photo has expired.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ImageOff,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Send,
  UserRound,
  WifiOff,
  X,
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
import { backupInterval } from '@/lib/realtime/client';
import { fetchFeed, type ChatProductCardView, type InboxSummaryView } from '@/lib/chat/inbox-client';
import {
  CHAT_MESSAGE_MAX,
  conversationHint,
  earliestSeq,
  latestSeq,
  mergeMessages,
  validateMessageText,
  CHAT_PHOTO_DAYS,
  type ChatPhotoUpload,
  type StaffChatMessage,
} from '@/lib/chat/rules';
import { PhotoError, photoProblem, uploadChatPhoto } from '@/lib/chat/photo-upload-client';
import { cloudinaryImage } from '@/lib/cloudinary/url';
import {
  blockConversation,
  reopenConversation,
  resolveConversation,
  sendReply,
  signReplyPhoto,
  unblockConversation,
} from '@/features/messages/actions';
import { CustomerPanel, ProductCard } from './CustomerPanel';
import type { MessagesPermissions, SelectedConversation } from './MessagesPageClient';
import { ADMIN_BACKUP_POLL_MS, useInboxRealtime } from './inbox-realtime';

/** A photo chosen in this browser: shown from the file until it's saved. */
type LocalPhoto = { file: File; previewUrl: string; uploaded?: ChatPhotoUpload };

/** A message on screen: saved (has a seq) or still on its way. */
type PaneMessage = Omit<StaffChatMessage, 'seq' | 'id'> & {
  id: string | null;
  seq: number | null;
  state?: 'sending' | 'failed';
  error?: string;
  localPhoto?: LocalPhoto;
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
  const [photo, setPhoto] = React.useState<LocalPhoto | null>(null);
  const photoInput = React.useRef<HTMLInputElement>(null);
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

  /* The page's shared real-time connection: an event for any conversation
   * means "fetch" — this conversation's new messages, and the inbox summary
   * that tells the list whether it changed. Live → polling drops to backup. */
  const realtime = useInboxRealtime();
  const { status: feedStatus, pollNow } = useChatFeed({
    enabled: true,
    poll,
    ...backupInterval(realtime.state, ADMIN_BACKUP_POLL_MS),
  });
  React.useEffect(() => realtime.subscribe(() => pollNow()), [realtime, pollNow]);

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

  async function deliver(message: PaneMessage) {
    const { clientId, body } = message;
    setSending(true);
    setMessages((current) =>
      current.map((m) => (m.clientId === clientId ? { ...m, state: 'sending', error: undefined } : m)),
    );
    const fail = (error: string) => {
      setSending(false);
      setMessages((current) => current.map((m) => (m.clientId === clientId ? { ...m, state: 'failed', error } : m)));
    };
    // Upload the photo once; a retry reuses it.
    let uploaded = message.localPhoto?.uploaded;
    if (message.localPhoto && !uploaded) {
      const signed = await signReplyPhoto();
      if (!signed.success) return fail(signed.error);
      try {
        uploaded = await uploadChatPhoto(message.localPhoto.file, signed.data.upload);
      } catch (error) {
        return fail(error instanceof PhotoError ? error.message : 'The photo didn’t upload. Please try again.');
      }
      const local = { ...message.localPhoto, uploaded };
      setMessages((current) => current.map((m) => (m.clientId === clientId ? { ...m, localPhoto: local } : m)));
    }
    const result = await sendReply({ conversationId: conversation.id, clientId, body, photo: uploaded ?? null });
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
    const checked = validateMessageText(draft, { hasPhoto: photo !== null });
    if (!checked.ok) {
      toast.error(checked.message);
      return;
    }
    const message: PaneMessage = {
      id: null,
      seq: null,
      clientId: newClientId(),
      sender: 'STAFF',
      staffUserId: null,
      staffName: null,
      body: checked.value,
      photo: null,
      photoExpired: false,
      localPhoto: photo ?? undefined,
      productId: null,
      createdAt: new Date().toISOString(),
      state: 'sending',
    };
    stickToBottom.current = true;
    setMessages((current) => [...current, message]);
    setDraft('');
    setPhoto(null);
    void deliver(message);
  }

  function editFailed(message: PaneMessage) {
    setMessages((current) => current.filter((m) => m.clientId !== message.clientId));
    setDraft((current) => (current ? `${message.body}\n${current}` : message.body));
    if (message.localPhoto) setPhoto(message.localPhoto);
  }

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setPhoto({ file, previewUrl: URL.createObjectURL(file) });
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
        {/* One line on every width: who it is on the left, the actions on the
            right. The status sits under the name, beside the hint it explains
            ("Open · Waiting for the customer"), so a phone never wraps the
            actions onto a ragged second row. */}
        <div className="flex items-start gap-3 border-b px-4 py-3 sm:px-6">
          <Link
            href={backHref}
            scroll={false}
            className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Back to all messages"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold leading-8">{name}</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {conversation.blocked ? (
                <Badge variant="destructive">Blocked</Badge>
              ) : resolved ? (
                <Badge variant="completed">Resolved</Badge>
              ) : (
                <Badge variant="info">Open</Badge>
              )}
              {conversation.isGuest && <Badge variant="muted">Guest</Badge>}
              <p className="text-xs text-muted-foreground">{conversationHint(conversation)}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="xl:hidden"
              onClick={() => setDetailsOpen(true)}
              aria-label="Customer details"
            >
              <UserRound className="size-3.5" />
              {/* An icon on a phone, so the actions stay on the name's line. */}
              <span className="hidden sm:inline">Customer details</span>
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
                    onRetry={() => deliver(message)}
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
              {photo && (
                <div className="mt-2 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.previewUrl} alt="The photo you’re sending" className="size-16 rounded-md border object-cover" />
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    Add a few words if you like. Photos are kept for {CHAT_PHOTO_DAYS} days.
                  </p>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setPhoto(null)} aria-label="Remove the photo">
                    <X className="size-4" />
                  </Button>
                </div>
              )}
              <div className="mt-1 flex items-end gap-2">
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(event) => {
                    choosePhoto(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  onClick={() => photoInput.current?.click()}
                  disabled={sending}
                  aria-label="Add a photo"
                  title="Add a photo"
                >
                  <ImagePlus className="size-4" />
                </Button>
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
                  placeholder={photo ? 'Add a caption (optional)…' : 'Type a reply…'}
                  aria-invalid={overLimit || undefined}
                  className="min-h-9 py-2"
                />
                <Button type="submit" size="lg" disabled={sending || (!draft.trim() && !photo) || overLimit}>
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
      <PhotoView message={message} mine={mine} />
      {message.body && (
        <div
          className={cn(
            'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm sm:max-w-[70%]',
            mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
            message.state === 'sending' && 'opacity-70',
            message.state === 'failed' && 'opacity-60',
            (message.photo || message.localPhoto || message.photoExpired) && 'mt-1',
          )}
        >
          {message.body}
        </div>
      )}
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

/** The photo on a message: from the file while sending, then the saved copy; a note once it has expired. */
function PhotoView({ message, mine }: { message: PaneMessage; mine: boolean }) {
  if (message.photoExpired) {
    return (
      <p className="flex max-w-[85%] items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground sm:max-w-[70%]">
        <ImageOff aria-hidden className="size-4 shrink-0" />
        Photo no longer available — photos are kept for {CHAT_PHOTO_DAYS} days.
      </p>
    );
  }
  const saved = message.photo;
  const src = saved ? cloudinaryImage(saved.url, { width: 640, crop: 'limit' }) : message.localPhoto?.previewUrl;
  if (!src) return null;
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={mine ? 'A photo you sent' : 'A photo from the shopper'}
      width={saved?.width ?? undefined}
      height={saved?.height ?? undefined}
      className={cn('max-h-80 w-auto max-w-full rounded-lg border bg-muted object-contain', message.state && 'opacity-70')}
    />
  );
  return (
    <div className="max-w-[85%] sm:max-w-[70%]">
      {saved ? (
        <a href={saved.url} target="_blank" rel="noopener noreferrer" aria-label="Open the photo full size" className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {image}
        </a>
      ) : (
        image
      )}
    </div>
  );
}
