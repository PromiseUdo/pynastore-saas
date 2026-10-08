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
 * Nothing here is written for the merchant: the greeting is theirs, or the
 * fixed line "Send the shop a message", and the store's replies are signed
 * "Store team". No promise about how fast anyone replies.
 */
import * as React from 'react';
import Link from 'next/link';
import { Loader2, Send, WifiOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useStorefront } from '@/lib/storefront/context';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { formatDate, formatTime } from '@/lib/storefront/format';
import { useChatStore } from '@/lib/storefront/stores/chat-store';
import { useChatFeed } from '@/lib/chat/use-chat-feed';
import {
  CHAT_MESSAGE_MAX,
  GUEST_NAME_MAX,
  earliestSeq,
  latestSeq,
  mergeMessages,
  validateMessage,
  type ShopperChatMessage,
} from '@/lib/chat/rules';
import {
  ChatRequestError,
  fetchShopperChat,
  markShopperChatRead,
  sendShopperMessage,
  type ShopperChatResponse,
} from '@/lib/storefront/chat-client';
import { useChatConfig } from './chat-config';
import { ChatRepliesPrompt } from './chat-replies-prompt';

type PanelMessage = Omit<ShopperChatMessage, 'seq' | 'id'> & {
  id: string | null;
  seq: number | null;
  state?: 'sending' | 'failed';
  error?: string;
};

const NEAR_BOTTOM_PX = 120;

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

  const { status: feedStatus, pollNow } = useChatFeed({ enabled: true, poll });

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
      const saved = await sendShopperMessage(org.slug, {
        clientId: message.clientId,
        body: message.body,
        productId: message.productId,
        guestName: shopper ? undefined : guestName.trim() || undefined,
      });
      const merged = mergeMessages(messagesRef.current, [saved]);
      messagesRef.current = merged;
      setMessages(merged);
      setStatus({ unread: 0, hasConversation: true });
      pollNow();
    } catch (error) {
      const failure = error instanceof ChatRequestError ? error : new ChatRequestError('Your message wasn’t sent.', 0);
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
    const checked = validateMessage(draft);
    if (!checked.ok) return;
    const message: PanelMessage = {
      id: null,
      seq: null,
      clientId: newClientId(),
      sender: 'CUSTOMER',
      author: null,
      body: checked.value,
      productId: product?.id ?? null,
      createdAt: new Date().toISOString(),
      state: 'sending',
    };
    stickToBottom.current = true;
    setMessages((current) => [...current, message]);
    setDraft('');
    clearProduct();
    void deliver(message);
  }

  function editFailed(message: PanelMessage) {
    setMessages((current) => current.filter((m) => m.clientId !== message.clientId));
    setDraft((current) => (current ? `${message.body}\n${current}` : message.body));
  }

  const blocked = conversation?.blocked ?? false;
  const canWrite = available && !blocked;
  const isGuestStarting = !shopper && !conversation && !messages.some((m) => m.seq !== null);
  const overLimit = draft.trim().length > CHAT_MESSAGE_MAX;
  const signInHref = `/account/sign-in?next=${encodeURIComponent(pathname || '/')}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* In the store's own app, once there's a conversation to be told about (17.4). */}
      {config?.pushReady && conversation && !blocked && <ChatRepliesPrompt org={org.slug} />}
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

      <div className="safe-bottom border-t px-5 py-3">
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
                  className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-accent"
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
            <div className="flex items-end gap-2">
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
                placeholder="Type a message…"
                aria-invalid={overLimit || undefined}
                disabled={!canWrite}
                className="min-h-11 rounded-xl px-4 py-2.5 text-base sm:text-sm"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim() || overLimit}
                aria-label="Send message"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
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
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
          mine ? 'rounded-br-md bg-brand text-primary-foreground' : 'rounded-bl-md bg-secondary text-foreground',
          message.state && 'opacity-70',
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
