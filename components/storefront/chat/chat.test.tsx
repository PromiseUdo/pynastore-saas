// @vitest-environment jsdom
/*
 * The storefront chat, rendered (ROADMAP 17.3): the ways in, the panel's
 * states, and the one-floating-button rule.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorefrontProvider, type StorefrontShopper } from '@/lib/storefront/context';
import type { ShopperChatMessage } from '@/lib/chat/rules';

const pathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const client = vi.hoisted(() => ({
  fetchShopperChat: vi.fn(),
  sendShopperMessage: vi.fn(),
  markShopperChatRead: vi.fn(),
  notifyChatReplies: vi.fn(async () => true),
}));
vi.mock('@/lib/storefront/chat-client', async (original) => ({
  ...(await original<typeof import('@/lib/storefront/chat-client')>()),
  ...client,
}));

const push = vi.hoisted(() => ({
  pushPermission: vi.fn(async () => 'prompt' as 'granted' | 'denied' | 'prompt' | 'unavailable'),
  registerForPush: vi.fn(async () => 'fcm-token' as string | null),
}));
vi.mock('@/lib/mobile/push-client', () => push);

const { ChatConfigProvider } = await import('./chat-config');
type ChatConfig = import('./chat-config').StorefrontChatConfig;
const { ChatLauncher } = await import('./chat-launcher');
const { ChatPanel } = await import('./chat-panel');
const { useChatStore } = await import('@/lib/storefront/stores/chat-store');
const { AssistantLauncher } = await import('@/components/storefront/assistant/assistant-launcher');
const { MobileTabBar } = await import('@/components/storefront/layout/mobile-tab-bar');
const { ChatRequestError } = await import('@/lib/storefront/chat-client');
const { ChatPageOpener } = await import('./chat-page-opener');

const ORG = { slug: 'acme', name: 'Acme Shoes', logoUrl: null };
const ADA: StorefrontShopper = { id: 'c1', name: 'Ada Okafor', firstName: 'Ada', email: 'ada@example.com' };
const ON: ChatConfig = { greeting: null, exists: false, unread: 0 };

function wrap(ui: React.ReactNode, chat: ChatConfig | null = ON, shopper: StorefrontShopper | null = null) {
  return render(
    <StorefrontProvider org={ORG} isMobileRuntime={false} shopper={shopper}>
      <ChatConfigProvider value={chat}>{ui}</ChatConfigProvider>
    </StorefrontProvider>,
  );
}

const storeReply = (seq: number, body: string): ShopperChatMessage => ({
  id: `m${seq}`,
  seq,
  sender: 'STAFF',
  author: 'Store team',
  body,
  productId: null,
  clientId: `staff-${seq}`,
  createdAt: '2026-10-08T09:00:00.000Z',
});

const EMPTY = { conversation: null, messages: [], hasEarlier: false, open: true };

beforeEach(() => {
  pathname.value = '/';
  useChatStore.setState({ open: false, product: null, unread: null, hasConversation: null });
  client.fetchShopperChat.mockResolvedValue(EMPTY);
  client.markShopperChatRead.mockResolvedValue(undefined);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the ways in', () => {
  it('shows nothing at all when the shop doesn’t take messages', () => {
    wrap(
      <>
        <ChatLauncher variant="floating" />
        <ChatLauncher variant="row" />
        <ChatLauncher variant="button" product={{ id: 'p1', name: 'Air Max' }} />
      </>,
      null,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers “Message us” in the corner, but not on the bag or at checkout', () => {
    wrap(<ChatLauncher variant="floating" />);
    expect(screen.getByRole('button', { name: /Message us/ })).toBeTruthy();
    cleanup();
    for (const path of ['/cart', '/checkout', '/checkout/payment']) {
      pathname.value = path;
      wrap(<ChatLauncher variant="floating" />);
      expect(screen.queryByRole('button', { name: /Message us/ })).toBeNull();
      cleanup();
    }
  });

  it('keeps the floating button off phones', () => {
    wrap(<ChatLauncher variant="floating" />);
    expect(screen.getByRole('button', { name: /Message us/ }).className).toMatch(/\bhidden\b.*\blg:inline-flex\b/);
  });

  it('says on the Account screen when the store has replied', () => {
    wrap(<ChatLauncher variant="row" />, { ...ON, exists: true, unread: 2 });
    const row = screen.getByRole('button', { name: /Message the store/ });
    expect(row.textContent).toContain('The store has replied');
    expect(row.textContent).toContain('2 unread replies');
  });

  it('opens the chat about the product from the product page', async () => {
    wrap(<ChatLauncher variant="button" product={{ id: 'p1', name: 'Air Max' }} />);
    await userEvent.click(screen.getByRole('button', { name: /Message the store about this/ }));
    expect(useChatStore.getState()).toMatchObject({ open: true, product: { id: 'p1', name: 'Air Max' } });
  });

  it('puts a dot on the phone’s Account tab when the store has replied', async () => {
    wrap(<MobileTabBar />, { ...ON, exists: true, unread: 1 });
    await waitFor(() => expect(screen.getByRole('link', { name: /the store has replied/ })).toBeTruthy());
  });

  it('turns the homepage’s floating assistant into a chip while chat holds the corner', () => {
    wrap(<AssistantLauncher seed={{ surface: 'home' }} label="Ask the assistant" variant="floating" />);
    expect(screen.getByRole('button', { name: /Ask the assistant/ }).className).not.toContain('sf-assistant-fab');
    cleanup();
    wrap(<AssistantLauncher seed={{ surface: 'home' }} label="Ask the assistant" variant="floating" />, null);
    expect(screen.getByRole('button', { name: /Ask the assistant/ }).className).toContain('sf-assistant-fab');
  });
});

describe('the panel', () => {
  it('opens with the fixed line when the merchant wrote no greeting, and the merchant’s own when they did', async () => {
    wrap(<ChatPanel />);
    await waitFor(() => expect(screen.getByText('Send the shop a message.')).toBeTruthy());
    cleanup();
    wrap(<ChatPanel />, { ...ON, greeting: 'Hi! Ask us about sizes.' });
    await waitFor(() => expect(screen.getByText('Hi! Ask us about sizes.')).toBeTruthy());
    expect(screen.queryByText('Send the shop a message.')).toBeNull();
  });

  it('asks a guest for an optional name, and a signed-in shopper for nothing', async () => {
    wrap(<ChatPanel />);
    await waitFor(() => expect(screen.getByLabelText(/Your name/)).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    cleanup();
    wrap(<ChatPanel />, ON, ADA);
    await waitFor(() => expect(screen.getByLabelText('Your message')).toBeTruthy());
    expect(screen.queryByLabelText(/Your name/)).toBeNull();
  });

  it('sends with the product it was opened from, then shows the message as sent', async () => {
    useChatStore.setState({ open: true, product: { id: 'p1', name: 'Air Max' } });
    // Empty until the first message; after it, the server has the conversation.
    client.fetchShopperChat
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValue({ ...EMPTY, conversation: { id: 'c', status: 'OPEN', unread: 0, blocked: false } });
    client.sendShopperMessage.mockImplementation(async (_org: string, m: { clientId: string; body: string; productId: string | null }) => ({
      id: 'm1',
      seq: 1,
      sender: 'CUSTOMER',
      author: null,
      body: m.body,
      productId: m.productId,
      clientId: m.clientId,
      createdAt: '2026-10-08T09:00:00.000Z',
    }));
    wrap(<ChatPanel />);
    await waitFor(() => expect(screen.getByText(/About:/)).toBeTruthy());

    await userEvent.type(screen.getByLabelText(/Your name/), 'Sarah');
    await userEvent.type(screen.getByLabelText('Your message'), 'Is this in size 43?{Enter}');

    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(client.sendShopperMessage).toHaveBeenCalledWith('acme', expect.objectContaining({ body: 'Is this in size 43?', productId: 'p1', guestName: 'Sarah' }));
    expect(screen.getAllByText('Is this in size 43?')).toHaveLength(1);
    expect(screen.queryByText(/About:/)).toBeNull();
    expect(useChatStore.getState().hasConversation).toBe(true);
  });

  it('keeps a failed message with “Not sent”, and retries it with the same clientId', async () => {
    client.sendShopperMessage.mockRejectedValueOnce(new ChatRequestError('Your message wasn’t sent. Check your connection and try again.', 0));
    wrap(<ChatPanel />, ON, ADA);
    await waitFor(() => expect(screen.getByLabelText('Your message')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('Your message'), 'Hello?{Enter}');
    await waitFor(() => expect(screen.getByText(/Not sent/)).toBeTruthy());

    const firstId = client.sendShopperMessage.mock.calls[0][1].clientId;
    client.sendShopperMessage.mockResolvedValueOnce({ ...storeReply(1, 'Hello?'), sender: 'CUSTOMER', author: null, clientId: firstId });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Not sent/)).toBeNull());
    expect(client.sendShopperMessage.mock.calls[1][1].clientId).toBe(firstId);
  });

  it('shows a store reply as “Store team” and marks it read', async () => {
    client.fetchShopperChat.mockResolvedValue({
      conversation: { id: 'c', status: 'OPEN', unread: 1, blocked: false },
      messages: [storeReply(2, 'Yes, size 43 is in stock.')],
      hasEarlier: false,
      open: true,
    });
    useChatStore.setState({ unread: 1 });
    wrap(<ChatPanel />, ON, ADA);
    await waitFor(() => expect(screen.getByText('Yes, size 43 is in stock.')).toBeTruthy());
    expect(screen.getByText(/Store team ·/)).toBeTruthy();
    expect(client.markShopperChatRead).toHaveBeenCalledWith('acme', 2);
    expect(useChatStore.getState().unread).toBe(0);
  });

  it('tells a blocked shopper, and offers no box to write in', async () => {
    client.fetchShopperChat.mockResolvedValue({
      conversation: { id: 'c', status: 'OPEN', unread: 0, blocked: true },
      messages: [],
      hasEarlier: false,
      open: true,
    });
    wrap(<ChatPanel />, ON, ADA);
    await waitFor(() => expect(screen.getByText('You can’t send messages to this store.')).toBeTruthy());
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });

  it('says so when the store stops taking messages, and keeps the history', async () => {
    client.fetchShopperChat.mockResolvedValue({
      conversation: { id: 'c', status: 'OPEN', unread: 0, blocked: false },
      messages: [storeReply(1, 'Earlier reply')],
      hasEarlier: false,
      open: false,
    });
    wrap(<ChatPanel />, ON, ADA);
    await waitFor(() => expect(screen.getByText('This store isn’t taking messages right now.')).toBeTruthy());
    expect(screen.getByText('Earlier reply')).toBeTruthy();
  });

  it('never promises how fast the store replies', async () => {
    await act(async () => {
      wrap(<ChatPanel />);
    });
    expect(document.body.textContent).not.toMatch(/minute|within|typically|usually|hours?/i);
  });
});

describe('reply notifications in the store’s app (17.4)', () => {
  const WITH_CONVERSATION = {
    conversation: { id: 'c', status: 'OPEN' as const, unread: 0, blocked: false },
    messages: [],
    hasEarlier: false,
    open: true,
  };

  it('offers them once there is a conversation, and turns them on when asked', async () => {
    client.fetchShopperChat.mockResolvedValue(WITH_CONVERSATION);
    wrap(<ChatPanel />, { ...ON, exists: true, pushReady: true }, ADA);
    const button = await screen.findByRole('button', { name: 'Turn on notifications' });
    await userEvent.click(button);
    await waitFor(() => expect(client.notifyChatReplies).toHaveBeenCalledWith('acme', 'fcm-token'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull());
  });

  it('adds the conversation quietly when the app is already allowed to notify', async () => {
    push.pushPermission.mockResolvedValueOnce('granted');
    client.fetchShopperChat.mockResolvedValue(WITH_CONVERSATION);
    wrap(<ChatPanel />, { ...ON, exists: true, pushReady: true }, ADA);
    await waitFor(() => expect(client.notifyChatReplies).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
  });

  it('never offers them in a browser, or before the first message', async () => {
    client.fetchShopperChat.mockResolvedValue(WITH_CONVERSATION);
    wrap(<ChatPanel />, { ...ON, exists: true, pushReady: false }, ADA);
    await waitFor(() => expect(client.fetchShopperChat).toHaveBeenCalled());
    expect(screen.queryByText(/notification when the store replies/)).toBeNull();
    cleanup();
    client.fetchShopperChat.mockResolvedValue(EMPTY);
    wrap(<ChatPanel />, { ...ON, pushReady: true }, ADA);
    await waitFor(() => expect(screen.getByLabelText('Your message')).toBeTruthy());
    expect(screen.queryByText(/notification when the store replies/)).toBeNull();
  });
});

describe('the /chat page', () => {
  it('opens the chat when it’s shown', () => {
    wrap(<ChatPageOpener />);
    expect(useChatStore.getState().open).toBe(true);
  });

  it('says so when the shop doesn’t take messages', () => {
    wrap(<ChatPageOpener />, null);
    expect(screen.getByText('This shop isn’t taking messages right now.')).toBeTruthy();
    expect(useChatStore.getState().open).toBe(false);
  });
});

