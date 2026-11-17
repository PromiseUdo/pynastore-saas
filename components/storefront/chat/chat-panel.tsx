'use client';

/*
 * The shopper's conversation with the store (ROADMAP 17.3).
 *
 * Polls /api/storefront/chat while it is open and the tab is visible —
 * every 3 seconds, easing to 10 after a quiet minute — and merges by `seq`,
 * so a reply arrives without a refresh and never shows twice. Seeing the
 * store's messages marks them read.
 *
 * A message shows at once as "Sending…". If it fails it stays, marked "Not
 * sent", with Try again (the same clientId, so it can't post twice) and
 * Edit — what the shopper typed is never thrown away.
 *
 * A photo can go with a message (the words are then optional): chosen with
 * the photo button, shown before sending, uploaded straight to Cloudinary
 * when sent, and kept CHAT_PHOTO_DAYS — after that the message says so.
 *
 * Nothing here is written for the merchant: the greeting is theirs, or the
 * fixed line "Send the shop a message", and the store's replies are signed
 * "Store team". No promise about how fast anyone replies.
 */
import * as React from 'react';
import Link from 'next/link';
import { ImageOff, ImagePlus, Loader2, Send, WifiOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useStorefront } from '@/lib/storefront/context';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { formatDate, formatTime } from '@/lib/storefront/format';
import { useChatStore } from '@/lib/storefront/stores/chat-store';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import { backupInterval, useRealtimeChannel } from '@/lib/realtime/client';
import {
  CHAT_MESSAGE_MAX,
  GUEST_NAME_MAX,
  earliestSeq,
  latestSeq,
  mergeMessages,
  validateMessageText,
  CHAT_PHOTO_DAYS,
  type ChatPhotoUpload,
  type ShopperChatMessage,
} from '@/lib/chat/rules';
import {
  ChatRequestError,
  fetchShopperChat,
  leaveShopperChat,
  markShopperChatRead,
  requestShopperPhotoUpload,
  sendShopperMessage,
  type ShopperChatResponse,
} from '@/lib/storefront/chat-client';
import { useChatConfig } from './chat-config';
import { ChatRepliesPrompt } from './chat-replies-prompt';
import { PhotoError, photoProblem, uploadChatPhoto } from '@/lib/chat/photo-upload-client';
import { cloudinaryImage } from '@/lib/cloudinary/url';

/** A photo chosen in this browser: shown from the file until it's saved. */
type LocalPhoto = { file: File; previewUrl: string; uploaded?: ChatPhotoUpload };

type PanelMessage = Omit<ShopperChatMessage, 'seq' | 'id'> & {
  id: string | null;
  seq: number | null;
  state?: 'sending' | 'failed';
  error?: string;
  localPhoto?: LocalPhoto;
};

const NEAR_BOTTOM_PX = 120;

/**
 * How often the panel still polls while real-time is live. Not just a safety
 * net: each poll refreshes the shopper's "seen" mark, which keeps the store's
 * reply push quiet while they're looking (SHOPPER_WATCHING_MS, 45s).
 */
export const SHOPPER_BACKUP_POLL_MS = 15_000;

function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ChatPanel() {
  const { org, shopper } = useStorefront();
  const config = useChatConfig();
  const pathname = usePublicPathname();
  const product = useChatStore((s) => s.product);
  const clearProduct = useChatStore((s) => s.clearProduct);
  const setStatus = useChatStore((s) => s.setStatus);

  const [messages, setMessages] = React.useState<PanelMessage[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [conversation, setConversation] = React.useState<ShopperChatResponse['conversation']>(null);
  const [available, setAvailable] = React.useState(true);
  const [hasEarlier, setHasEarlier] = React.useState(false);
  const [loadingEarlier, setLoadingEarlier] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [guestName, setGuestName] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [photo, setPhoto] = React.useState<LocalPhoto | null>(null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const photoInput = React.useRef<HTMLInputElement>(null);

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) {
      setPhotoError(problem);
      return;
    }
    setPhotoError(null);
    setPhoto({ file, previewUrl: URL.createObjectURL(file) });
  }

  const messagesRef = React.useRef(messages);
  const loadedRef = React.useRef(loaded);
  React.useLayoutEffect(() => {
    messagesRef.current = messages;
    loadedRef.current = loaded;
  }, [messages, loaded]);

  /** Take in an answer from the server: messages, state, the shared badge. */
  const absorb = React.useCallback(
    (response: ShopperChatResponse) => {
      const merged = mergeMessages(messagesRef.current, response.messages);
      messagesRef.current = merged;
      setMessages(merged);
      setConversation(response.conversation);
      setAvailable(response.open);
      const unread = response.conversation?.unread ?? 0;
      if (unread > 0) void markShopperChatRead(org.slug, latestSeq(merged));
      setStatus({ unread: 0, hasConversation: Boolean(response.conversation) });
    },
    [org.slug, setStatus],
  );

  const poll = React.useCallback(async () => {
    const first = !loadedRef.current;
    const before = latestSeq(messagesRef.current);
    const response = await fetchShopperChat(org.slug, { after: first ? undefined : before, open: true });
    if (first) {
      setHasEarlier(Boolean(response.hasEarlier));
      setLoaded(true);
      loadedRef.current = true;
    }
    absorb(response);
    return response.messages.some((m) => m.seq > before);
  }, [absorb, org.slug]);

  /* Real-time hints, once there's a conversation to listen to: any event —
   * or any sign events were missed — just asks for what's after the newest
   * message held. While it's live, polling drops to the backup pace. */
  const pollNowRef = React.useRef<() => void>(() => {});
  const realtime = useRealtimeChannel({
    enabled: Boolean(config?.realtime && conversation),
    tokenUrl: '/api/storefront/chat/realtime-token',
    tokenBody: { org: org.slug },
    onEvent: () => pollNowRef.current(),
    onCatchUp: () => pollNowRef.current(),
  });

  const { status: feedStatus, pollNow } = useChatFeed({
    enabled: true,
    poll,
    ...backupInterval(realtime, SHOPPER_BACKUP_POLL_MS),
  });
  React.useEffect(() => {
    pollNowRef.current = pollNow;
  }, [pollNow]);

  /* Looking, or not: the server holds a reply's push back only while the
   * shopper is looking at this panel. Closing it, or the app or tab going
   * into the background, says so at once; coming back, the next poll (which
   * runs straight away) marks them as looking again. */
  React.useEffect(() => {
    const away = () => leaveShopperChat(org.slug);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') away();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', away);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', away);
      away();
    };
  }, [org.slug]);

  /* ── Scrolling ───────────────────────────────────────────────────────── */

  const scroller = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);
  const keepOffset = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
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
      const response = await fetchShopperChat(org.slug, { before });
      const el = scroller.current;
      if (el) keepOffset.current = el.scrollHeight - el.scrollTop;
      const merged = mergeMessages(messagesRef.current, response.messages);
      messagesRef.current = merged;
      setMessages(merged);
      setHasEarlier(Boolean(response.hasEarlier));
    } catch {
      // The button stays; trying again is the remedy.
    } finally {
      setLoadingEarlier(false);
    }
  }

  /* ── Sending ─────────────────────────────────────────────────────────── */

  async function deliver(message: PanelMessage) {
    setSending(true);
    setMessages((current) => current.map((m) => (m.clientId === message.clientId ? { ...m, state: 'sending', error: undefined } : m)));
    try {
      // Upload the photo once; a retry reuses it.
      let uploaded = message.localPhoto?.uploaded;
      if (message.localPhoto && !uploaded) {
        uploaded = await uploadChatPhoto(message.localPhoto.file, await requestShopperPhotoUpload(org.slug));
        const local = { ...message.localPhoto, uploaded };
        setMessages((current) => current.map((m) => (m.clientId === message.clientId ? { ...m, localPhoto: local } : m)));
        message = { ...message, localPhoto: local };
      }
      const saved = await sendShopperMessage(org.slug, {
        clientId: message.clientId,
        body: message.body,
        productId: message.productId,
        guestName: shopper ? undefined : guestName.trim() || undefined,
        photo: uploaded ?? null,
      });
      const merged = mergeMessages(messagesRef.current, [saved]);
      messagesRef.current = merged;
      setMessages(merged);
      setStatus({ unread: 0, hasConversation: true });
      pollNow();
    } catch (error) {
      const failure =
        error instanceof ChatRequestError
          ? error
          : new ChatRequestError(error instanceof PhotoError ? error.message : 'Your message wasn’t sent.', 0);
      if (failure.code === 'unavailable') setAvailable(false);
      if (failure.code === 'blocked') setConversation((c) => (c ? { ...c, blocked: true } : c));
      setMessages((current) =>
        current.map((m) => (m.clientId === message.clientId ? { ...m, state: 'failed', error: failure.message } : m)),
      );
    } finally {
      setSending(false);
    }
  }

  function send() {
    if (sending) return;
    const checked = validateMessageText(draft, { hasPhoto: photo !== null });
    if (!checked.ok) return;
    const message: PanelMessage = {
      id: null,
      seq: null,
      clientId: newClientId(),
      sender: 'CUSTOMER',
      author: null,
      body: checked.value,
      photo: null,
      photoExpired: false,
      localPhoto: photo ?? undefined,
      productId: product?.id ?? null,
      createdAt: new Date().toISOString(),
      state: 'sending',
    };
    stickToBottom.current = true;
    setMessages((current) => [...current, message]);
    setDraft('');
    setPhoto(null);
    clearProduct();
    void deliver(message);
  }

  function editFailed(message: PanelMessage) {
    setMessages((current) => current.filter((m) => m.clientId !== message.clientId));
    setDraft((current) => (current ? `${message.body}\n${current}` : message.body));
    if (message.localPhoto) setPhoto(message.localPhoto);
  }

  const blocked = conversation?.blocked ?? false;
  const canWrite = available && !blocked;
  const isGuestStarting = !shopper && !conversation && !messages.some((m) => m.seq !== null);
  const overLimit = draft.trim().length > CHAT_MESSAGE_MAX;
  const signInHref = `/account/sign-in?next=${encodeURIComponent(pathname || '/')}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* In the store's own app, once there's a conversation to be told about (17.4). */}
      {config?.push && conversation && !blocked && <ChatRepliesPrompt org={org.slug} channel={config.push} />}
      {feedStatus === 'reconnecting' && (
        <p role="status" className="flex items-center gap-2 border-b bg-secondary/60 px-5 py-2 text-xs text-muted-foreground">
          <WifiOff aria-hidden className="size-3.5" />
          Reconnecting… new replies will appear when you’re back online.
        </p>
      )}

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        <div className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm">
          <p className="whitespace-pre-wrap break-words">{config?.greeting || 'Send the shop a message.'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Replies from the store appear here.</p>
        </div>

        {!loaded ? (
          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Loading your messages…
          </p>
        ) : (
          <>
            {hasEarlier && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={loadEarlier}
                  disabled={loadingEarlier}
                  className="inline-flex h-9 items-center gap-2 rounded-[var(--sf-radius-button,999px)] border px-4 text-xs font-medium hover:border-brand hover:text-brand disabled:opacity-60"
                >
                  {loadingEarlier && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
                  Load earlier messages
                </button>
              </div>
            )}
            <ol role="log" aria-live="polite" aria-label={`Your messages with ${org.name}`} className="mt-4 space-y-3">
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const day = formatDate(message.createdAt);
                const newDay = !previous || formatDate(previous.createdAt) !== day;
                return (
                  <li key={message.clientId}>
                    {newDay && <p className="my-3 text-center text-xs text-muted-foreground">{day}</p>}
                    <Bubble message={message} onRetry={() => deliver(message)} onEdit={() => editFailed(message)} />
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      {/* Its own padding PLUS the phone's bottom inset (home bar, gesture bar):
        * `safe-bottom` alone replaced the padding and left the row flush with
        * the edge wherever the inset is 0 — most Android phones, and whenever
        * the keyboard is up (globals.css). */}
      <div className="safe-pb-4 border-t px-5 pt-3">
        {blocked ? (
          <p className="text-sm text-muted-foreground">You can’t send messages to this store.</p>
        ) : !available ? (
          <p className="text-sm text-muted-foreground">This store isn’t taking messages right now.</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="space-y-2"
          >
            {product && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  About: <span className="font-medium text-foreground">{product.name}</span>
                </span>
                <button
                  type="button"
                  onClick={clearProduct}
                  aria-label={`Don’t send this about ${product.name}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-(--sf-radius-button) hover:bg-accent"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </p>
            )}
            {isGuestStarting && (
              <div>
                <Label htmlFor="chat-guest-name" className="text-xs font-semibold">
                  Your name <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="chat-guest-name"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  maxLength={GUEST_NAME_MAX}
                  autoComplete="name"
                  className="mt-1 h-10 rounded-xl"
                />
              </div>
            )}
            <Label htmlFor="chat-message" className="text-xs font-semibold">
              Your message
            </Label>
            {photo && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.previewUrl} alt="The photo you’re sending" className="size-16 rounded-xl border object-cover" />
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Add a few words if you like. Photos are kept for {CHAT_PHOTO_DAYS} days.
                </p>
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  aria-label="Remove the photo"
                  className="flex size-8 shrink-0 items-center justify-center rounded-(--sf-radius-button) hover:bg-accent"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            )}
            {photoError && <p className="text-xs text-destructive">{photoError}</p>}
            <div className="flex items-end gap-2">
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
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                disabled={!canWrite || sending}
                aria-label="Add a photo"
                title="Add a photo"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--sf-radius-button) border text-muted-foreground transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <ImagePlus aria-hidden className="size-4" />
              </button>
              <Textarea
                id="chat-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    send();
                  }
                }}
                rows={Math.min(5, Math.max(1, draft.split('\n').length))}
                placeholder={photo ? 'Add a caption (optional)…' : 'Type a message…'}
                aria-invalid={overLimit || undefined}
                disabled={!canWrite}
                className="min-h-11 rounded-xl px-4 py-2.5 text-base sm:text-sm"
              />
              <button
                type="submit"
                disabled={sending || (!draft.trim() && !photo) || overLimit}
                aria-label="Send message"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--sf-radius-button) bg-brand text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
              </button>
            </div>
            {overLimit ? (
              <p className="text-xs text-destructive">Too long by {draft.trim().length - CHAT_MESSAGE_MAX} characters.</p>
            ) : (
              isGuestStarting && (
                <p className="text-xs text-muted-foreground">
                  Have an account?{' '}
                  <Link href={signInHref} className="font-medium text-brand underline-offset-2 hover:underline">
                    Sign in
                  </Link>{' '}
                  to keep this conversation with it.
                </p>
              )
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function Bubble({ message, onRetry, onEdit }: { message: PanelMessage; onRetry: () => void; onEdit: () => void }) {
  const mine = message.sender === 'CUSTOMER';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <ChatPhotoView message={message} mine={mine} />
      {message.body && (
        <div
          className={cn(
            'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
            mine ? 'rounded-br-md bg-brand text-primary-foreground' : 'rounded-bl-md bg-secondary text-foreground',
            message.state && 'opacity-70',
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
            <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
              Try again
            </button>
            {' · '}
            <button type="button" onClick={onEdit} className="font-semibold underline underline-offset-2">
              Edit
            </button>
          </span>
        ) : (
          <>
            {mine ? 'You' : (message.author ?? 'Store team')} · <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </>
        )}
      </p>
    </div>
  );
}

/** The photo on a message: from the file while sending, then the saved copy; a note once it has expired. */
function ChatPhotoView({ message, mine }: { message: PanelMessage; mine: boolean }) {
  const corner = mine ? 'rounded-br-md' : 'rounded-bl-md';
  if (message.photoExpired) {
    return (
      <p className={cn('flex max-w-[85%] items-center gap-2 rounded-2xl border border-dashed px-4 py-2.5 text-xs text-muted-foreground', corner)}>
        <ImageOff aria-hidden className="size-4 shrink-0" />
        Photo no longer available — photos are kept for {CHAT_PHOTO_DAYS} days.
      </p>
    );
  }
  const saved = message.photo;
  const src = saved ? cloudinaryImage(saved.url, { width: 560, crop: 'limit' }) : message.localPhoto?.previewUrl;
  if (!src) return null;
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={mine ? 'A photo you sent' : 'A photo from the store'}
      width={saved?.width ?? undefined}
      height={saved?.height ?? undefined}
      className={cn('max-h-72 w-auto max-w-full rounded-2xl border bg-secondary object-contain', corner, message.state && 'opacity-70')}
    />
  );
  return (
    <div className="max-w-[85%]">
      {saved ? (
        <a href={saved.url} target="_blank" rel="noopener noreferrer" aria-label="Open the photo full size">
          {image}
        </a>
      ) : (
        image
      )}
    </div>
  );
}
