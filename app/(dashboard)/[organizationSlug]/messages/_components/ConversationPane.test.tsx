// @vitest-environment jsdom
/*
 * The open conversation, rendered: a reply shows at once as "Sending…",
 * becomes a normal message when saved, and on failure stays with "Not sent"
 * and a retry that reuses its clientId (so it can't post twice). A member
 * who can only view gets no reply box.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StaffChatMessage } from '@/lib/chat/rules';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const sendReply = vi.fn();
vi.mock('@/features/messages/actions', () => ({
  sendReply: (...args: unknown[]) => sendReply(...args),
  resolveConversation: vi.fn(),
  reopenConversation: vi.fn(),
  blockConversation: vi.fn(),
  unblockConversation: vi.fn(),
}));

const fetchFeed = vi.fn();
vi.mock('@/lib/chat/inbox-client', () => ({ fetchFeed: (...args: unknown[]) => fetchFeed(...args) }));

const { ConversationPane } = await import('./ConversationPane');

const SUMMARY = { unreadConversations: 0, changedAt: null, latestUnread: null };
const CAN = { reply: true, viewCustomers: true, viewOrders: true, viewProducts: true, viewSettings: true };

const shopperMessage: StaffChatMessage = {
  id: 'm1',
  seq: 1,
  sender: 'CUSTOMER',
  staffUserId: null,
  staffName: null,
  body: 'Is this shoe available in size 43?',
  productId: null,
  clientId: 'client-one',
  createdAt: '2026-10-08T09:00:00.000Z',
};

function renderPane(can = CAN) {
  return render(
    <ConversationPane
      selected={{
        conversation: {
          id: 'conv-1',
          name: 'Ada Okafor',
          isGuest: false,
          preview: shopperMessage.body,
          lastMessageAt: shopperMessage.createdAt,
          lastSender: 'CUSTOMER',
          status: 'OPEN',
          unread: 1,
          awaitingReply: true,
          blocked: false,
          createdAt: shopperMessage.createdAt,
          resolvedAt: null,
          customer: { id: 'cust-1', email: 'ada@example.com', customerSince: '2026-01-01T00:00:00.000Z', orderCount: 3 },
          latestProductId: null,
        },
        messages: [shopperMessage],
        hasEarlier: false,
        products: {},
      }}
      backHref="/messages"
      currency="NGN"
      can={can}
      onSummary={vi.fn()}
    />,
  );
}

beforeEach(() => {
  fetchFeed.mockResolvedValue({ summary: SUMMARY, messages: [], products: {} });
  sendReply.mockReset();
  if (!('randomUUID' in crypto)) Object.assign(crypto, { randomUUID: () => 'x'.repeat(36) });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConversationPane', () => {
  it('shows the conversation and marks it read on the first poll', async () => {
    renderPane();
    expect(screen.getByText('Is this shoe available in size 43?')).toBeTruthy();
    expect(screen.getByText('Awaiting your reply')).toBeTruthy();
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledWith({ conversationId: 'conv-1', after: 1, read: 1, inbox: true }));
  });

  it('shows a reply as sending, then as sent', async () => {
    let finish: (value: unknown) => void = () => {};
    sendReply.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderPane();

    await userEvent.type(screen.getByLabelText(/Your reply to Ada Okafor/), 'Yes, size 43 is available.{Enter}');
    expect(screen.getByText('Yes, size 43 is available.')).toBeTruthy();
    expect(screen.getByText('Sending…')).toBeTruthy();
    expect((screen.getByLabelText(/Your reply to Ada Okafor/) as HTMLTextAreaElement).value).toBe('');

    const { clientId } = sendReply.mock.calls[0][0] as { clientId: string };
    finish({
      success: true,
      data: {
        message: { ...shopperMessage, id: 'm2', seq: 2, sender: 'STAFF', staffUserId: 'u1', staffName: 'Kemi', body: 'Yes, size 43 is available.', clientId },
      },
    });
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(screen.getAllByText('Yes, size 43 is available.')).toHaveLength(1);
    expect(screen.getByText(/Kemi ·/)).toBeTruthy();
  });

  it('keeps a failed reply with “Not sent”, and retries it with the same clientId', async () => {
    sendReply.mockResolvedValueOnce({ success: false, error: 'Your reply wasn’t sent. Please try again.' });
    renderPane();
    await userEvent.type(screen.getByLabelText(/Your reply to Ada Okafor/), 'Hello there{Enter}');

    await waitFor(() => expect(screen.getByText(/Not sent/)).toBeTruthy());
    expect(screen.getByText('Hello there')).toBeTruthy();

    const firstId = (sendReply.mock.calls[0][0] as { clientId: string }).clientId;
    sendReply.mockResolvedValueOnce({
      success: true,
      data: { message: { ...shopperMessage, id: 'm2', seq: 2, sender: 'STAFF', staffName: 'Kemi', body: 'Hello there', clientId: firstId } },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Not sent/)).toBeNull());
    expect((sendReply.mock.calls[1][0] as { clientId: string }).clientId).toBe(firstId);
  });

  it('puts a failed reply back in the box with Edit', async () => {
    sendReply.mockResolvedValueOnce({ success: false, error: 'No connection' });
    renderPane();
    await userEvent.type(screen.getByLabelText(/Your reply to Ada Okafor/), 'Draft text{Enter}');
    await waitFor(() => expect(screen.getByText(/Not sent/)).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText(/Your reply to Ada Okafor/) as HTMLTextAreaElement).value).toBe('Draft text');
    expect(screen.queryByText(/Not sent/)).toBeNull();
  });

  it('keeps Shift+Enter as a new line, and won’t send an empty reply', async () => {
    renderPane();
    const box = screen.getByLabelText(/Your reply to Ada Okafor/) as HTMLTextAreaElement;
    await userEvent.type(box, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(box.value).toBe('Line one\nLine two');
    expect(sendReply).not.toHaveBeenCalled();

    await userEvent.clear(box);
    expect((screen.getByRole('button', { name: /Send reply/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a store message that arrives by poll, once', async () => {
    const reply = { ...shopperMessage, id: 'm2', seq: 2, body: 'Also, do you deliver?', clientId: 'client-two' };
    fetchFeed.mockResolvedValue({ summary: SUMMARY, messages: [reply], products: {} });
    renderPane();
    await waitFor(() => expect(screen.getByText('Also, do you deliver?')).toBeTruthy());
    expect(screen.getAllByText('Also, do you deliver?')).toHaveLength(1);
  });

  it('gives a view-only member no reply box and no actions, and never marks read for them', async () => {
    renderPane({ ...CAN, reply: false });
    expect(screen.queryByLabelText(/Your reply/)).toBeNull();
    expect(screen.getByText(/You can read messages but not reply/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Resolve/ })).toBeNull();
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledWith({ conversationId: 'conv-1', after: 1, read: undefined, inbox: true }));
  });
});
