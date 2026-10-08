// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/sales/orders';
const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));

const toast = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }));

const fetchFeed = vi.fn();
vi.mock('@/lib/chat/inbox-client', async (original) => ({
  ...(await original<typeof import('@/lib/chat/inbox-client')>()),
  fetchFeed: (...args: unknown[]) => fetchFeed(...args),
}));

const { InboxWatcher } = await import('./inbox-watcher');
const { useInboxStore } = await import('@/lib/chat/inbox-client');

const summary = (count: number, at: string | null, name = 'Ada') => ({
  unreadConversations: count,
  changedAt: at,
  latestUnread: at ? { id: `conv-${at}`, name, lastMessageAt: at } : null,
});
/** What the feed answers: the summary, wrapped. */
const answer = (count: number, at: string | null, name?: string) => ({ summary: summary(count, at, name) });

beforeEach(() => {
  pathname = '/sales/orders';
  document.title = 'Orders';
  useInboxStore.setState({ summary: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InboxWatcher', () => {
  it('counts unread conversations in the tab title, and takes it off when there are none', async () => {
    fetchFeed.mockResolvedValue(answer(2, '2026-10-08T09:00:00.000Z'));
    render(<InboxWatcher />);
    await waitFor(() => expect(document.title).toBe('(2) Orders'));

    // A navigation sets a new title; the count goes back on it.
    act(() => {
      document.title = 'Customers';
    });
    await waitFor(() => expect(document.title).toBe('(2) Customers'));

    act(() => useInboxStore.getState().setSummary(summary(0, null)));
    await waitFor(() => expect(document.title).toBe('Customers'));
  });

  it('doesn’t announce what was already waiting, but does announce a new message', async () => {
    fetchFeed.mockResolvedValueOnce(answer(1, '2026-10-08T09:00:00.000Z'));
    render(<InboxWatcher />);
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
    expect(toast).not.toHaveBeenCalled();

    fetchFeed.mockResolvedValueOnce(answer(2, '2026-10-08T09:05:00.000Z', 'Chidi'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).toBe('New message from Chidi');
  });

  it('leaves polling to the Messages page while it’s open', async () => {
    pathname = '/messages';
    fetchFeed.mockResolvedValue(answer(1, '2026-10-08T09:00:00.000Z'));
    render(<InboxWatcher />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchFeed).not.toHaveBeenCalled();
  });
});
