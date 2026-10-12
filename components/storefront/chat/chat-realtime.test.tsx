// @vitest-environment jsdom
/*
 * The chat screens' real-time wiring: they listen only when there's
 * something to hear, an event means "fetch from the database", and polling
 * drops to its backup pace only while real-time is live.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StorefrontProvider } from '@/lib/storefront/context';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

/* The real-time hook and the poll timer, observed rather than run. */
const rt = vi.hoisted(() => ({
  state: 'off' as 'off' | 'connecting' | 'live' | 'down',
  calls: [] as { enabled: boolean; tokenUrl: string; tokenBody?: unknown; onEvent: (e: unknown) => void; onCatchUp: () => void }[],
}));
vi.mock('@/lib/chat/realtime-client', async (original) => ({
  ...(await original<typeof import('@/lib/chat/realtime-client')>()),
  useRealtimeChannel: (options: (typeof rt.calls)[number]) => {
    rt.calls.push(options);
    return rt.state;
  },
}));
const feed = vi.hoisted(() => ({ calls: [] as { fastMs?: number; slowMs?: number; poll: () => Promise<boolean> }[], pollNow: vi.fn() }));
vi.mock('@/lib/chat/use-chat-feed', () => ({
  useChatFeed: (options: (typeof feed.calls)[number] & { enabled: boolean }) => {
    feed.calls.push(options);
    React.useEffect(() => {
      if (options.enabled) void options.poll().catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return { status: 'live', pollNow: feed.pollNow };
  },
}));

const client = vi.hoisted(() => ({ fetchShopperChat: vi.fn(), sendShopperMessage: vi.fn(), markShopperChatRead: vi.fn(), notifyChatReplies: vi.fn() }));
vi.mock('@/lib/storefront/chat-client', async (original) => ({ ...(await original<typeof import('@/lib/storefront/chat-client')>()), ...client }));
const adminFeed = vi.hoisted(() => ({ fetchFeed: vi.fn() }));
vi.mock('@/lib/chat/inbox-client', async (original) => ({ ...(await original<typeof import('@/lib/chat/inbox-client')>()), ...adminFeed }));
vi.mock('@/features/messages/actions', () => ({
  sendReply: vi.fn(),
  resolveConversation: vi.fn(),
  reopenConversation: vi.fn(),
  blockConversation: vi.fn(),
  unblockConversation: vi.fn(),
}));

const { ChatConfigProvider } = await import('./chat-config');
const { ChatPanel, SHOPPER_BACKUP_POLL_MS } = await import('./chat-panel');
const { ConversationPane } = await import('@/app/(dashboard)/[organizationSlug]/messages/_components/ConversationPane');
const { InboxRealtimeContext, ADMIN_BACKUP_POLL_MS } = await import('@/app/(dashboard)/[organizationSlug]/messages/_components/inbox-realtime');

const ORG = { slug: 'acme', name: 'Acme', logoUrl: null };
const CONVERSATION = { id: 'conv-1', status: 'OPEN' as const, unread: 0, blocked: false };

function shopperPanel(realtime = true) {
  return render(
    <StorefrontProvider org={ORG} isMobileRuntime={false} shopper={null}>
      <ChatConfigProvider value={{ greeting: null, exists: true, unread: 0, realtime }}>
        <ChatPanel />
      </ChatConfigProvider>
    </StorefrontProvider>,
  );
}

beforeEach(() => {
  rt.state = 'off';
  rt.calls = [];
  feed.calls = [];
  feed.pollNow.mockClear();
  client.fetchShopperChat.mockResolvedValue({ conversation: CONVERSATION, messages: [], hasEarlier: false, open: true });
  adminFeed.fetchFeed.mockResolvedValue({ summary: { unreadConversations: 0, changedAt: null, latestUnread: null }, messages: [], products: {} });
});

afterEach(() => {
  cleanup();
});

describe('the storefront chat panel', () => {
  it('listens to its own conversation through the shopper token route, once one exists', async () => {
    client.fetchShopperChat.mockResolvedValueOnce({ conversation: null, messages: [], hasEarlier: false, open: true });
    shopperPanel();
    expect(rt.calls.at(-1)).toMatchObject({ enabled: false, tokenUrl: '/api/storefront/chat/realtime-token', tokenBody: { org: 'acme' } });

    // After the first message, the next fetch finds the conversation and the panel starts listening.
    client.fetchShopperChat.mockResolvedValue({ conversation: CONVERSATION, messages: [], hasEarlier: false, open: true });
    act(() => {
      cleanup();
    });
    shopperPanel();
    await waitFor(() => expect(rt.calls.at(-1)?.enabled).toBe(true));
  });

  it('never listens when real-time isn’t set up', async () => {
    shopperPanel(false);
    await waitFor(() => expect(client.fetchShopperChat).toHaveBeenCalled());
    expect(rt.calls.every((call) => call.enabled === false)).toBe(true);
  });

  it('fetches on an event, and on a catch-up signal', async () => {
    shopperPanel();
    await waitFor(() => expect(rt.calls.at(-1)?.enabled).toBe(true));
    act(() => rt.calls.at(-1)!.onEvent({ type: 'message', conversationId: 'conv-1', seq: 9, sender: 'STAFF' }));
    act(() => rt.calls.at(-1)!.onCatchUp());
    expect(feed.pollNow).toHaveBeenCalledTimes(2);
  });

  it('polls at the backup pace only while real-time is live', async () => {
    rt.state = 'live';
    shopperPanel();
    expect(feed.calls.at(-1)).toMatchObject({ fastMs: SHOPPER_BACKUP_POLL_MS, slowMs: SHOPPER_BACKUP_POLL_MS });
    cleanup();
    for (const state of ['down', 'connecting', 'off'] as const) {
      rt.state = state;
      feed.calls = [];
      shopperPanel();
      expect(feed.calls.at(-1)?.fastMs).toBeUndefined();
      cleanup();
    }
  });

  it('keeps the backup poll fast enough to hold off the reply push while the shopper is looking', async () => {
    const { SHOPPER_WATCHING_MS } = await import('@/lib/chat/alerts');
    // the "seen" mark is throttled to 20s; one more backup poll must land inside the window
    expect(20_000 + SHOPPER_BACKUP_POLL_MS).toBeLessThan(SHOPPER_WATCHING_MS);
  });
});

describe('the merchant’s open conversation', () => {
  function pane(state: 'live' | 'down', subscribe: (listener: (event: unknown) => void) => () => void) {
    return render(
      <InboxRealtimeContext.Provider value={{ state, subscribe: subscribe as never }}>
        <ConversationPane
          selected={{
            conversation: {
              id: 'conv-1',
              name: 'Ada',
              isGuest: false,
              preview: 'Hi',
              lastMessageAt: '2026-10-12T09:00:00.000Z',
              lastSender: 'CUSTOMER',
              status: 'OPEN',
              unread: 1,
              awaitingReply: true,
              blocked: false,
              createdAt: '2026-10-12T09:00:00.000Z',
              resolvedAt: null,
              customer: null,
              latestProductId: null,
            },
            messages: [],
            hasEarlier: false,
            products: {},
          }}
          backHref="/messages"
          currency="NGN"
          can={{ reply: true, viewCustomers: true, viewOrders: true, viewProducts: true, viewSettings: true }}
          onSummary={vi.fn()}
        />
      </InboxRealtimeContext.Provider>,
    );
  }

  it('shares the page’s connection, and fetches when the inbox hears anything', () => {
    let listener: ((event: unknown) => void) | null = null;
    pane('live', (l) => {
      listener = l;
      return () => {};
    });
    expect(listener).not.toBeNull();
    act(() => listener!({ type: 'message', conversationId: 'conv-1', seq: 2, sender: 'CUSTOMER' }));
    act(() => listener!(null)); // "you may have missed some"
    expect(feed.pollNow).toHaveBeenCalledTimes(2);
  });

  it('polls at the backup pace only while real-time is live — slow enough to save queries, fast enough to hold off the email', async () => {
    pane('live', () => () => {});
    expect(feed.calls.at(-1)).toMatchObject({ fastMs: ADMIN_BACKUP_POLL_MS, slowMs: ADMIN_BACKUP_POLL_MS });
    const { INBOX_WATCHING_MS } = await import('@/lib/chat/alerts');
    expect(ADMIN_BACKUP_POLL_MS * 2).toBeLessThan(INBOX_WATCHING_MS);
    cleanup();
    feed.calls = [];
    pane('down', () => () => {});
    expect(feed.calls.at(-1)?.fastMs).toBeUndefined();
  });
});
