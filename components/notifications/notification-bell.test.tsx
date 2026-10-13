// @vitest-environment jsdom
/*
 * The bell in the browser (ROADMAP 18.2): the count it was told, the list
 * when it opens, opening an entry, and "Mark all read" — with the feed
 * stubbed at fetch and real-time off (the token route answers 503).
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

import { NotificationBell } from './notification-bell';

type Sent = { url: string; body: Record<string, unknown> };
let sent: Sent[] = [];
let unread = 2;
const items = [
  { id: 'n1', title: 'Order R1 cancelled', body: 'Ada cancelled their order.', href: '/sales/orders/o1', createdAt: new Date().toISOString(), read: false },
  { id: 'n2', title: 'Low stock: Shoe', body: '2 left at Lagos.', href: null, createdAt: new Date().toISOString(), read: false },
];

beforeEach(() => {
  sent = [];
  unread = 2;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      sent.push({ url, body });
      if (url.endsWith('/realtime-token')) return new Response('{}', { status: 503 });
      if (body.readAll) unread = 0;
      else if (typeof body.read === 'string') unread -= 1;
      const list = items.map((i) => ({ ...i, read: unread === 0 || i.read }));
      return Response.json(body.latest ? { unread, items: list } : { unread });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the notification bell', () => {
  it('shows the unread count it was told', async () => {
    render(<NotificationBell base="/notifications" />);
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy();
    expect(sent.some((s) => s.url === '/notifications/feed')).toBe(true);
  });

  it('opens on the latest, marks an opened one read, and clears the lot', async () => {
    const user = userEvent.setup();
    render(<NotificationBell base="/notifications" />);
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));

    const link = await screen.findByRole('menuitem', { name: /Order R1 cancelled/ });
    expect(link.getAttribute('href')).toBe('/sales/orders/o1');
    expect(screen.getByRole('menuitem', { name: /See all notifications/ }).getAttribute('href')).toBe('/notifications');

    await user.click(screen.getByRole('button', { name: /Mark all read/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Mark all read/ })).toBeNull());
    expect(sent.some((s) => s.body.readAll === true)).toBe(true);
  });

  it('marks an entry read when it is opened', async () => {
    const user = userEvent.setup();
    render(<NotificationBell base="/platform/notifications" />);
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await user.click(await screen.findByRole('menuitem', { name: /Low stock: Shoe/ }));

    await waitFor(() => expect(sent.some((s) => s.url === '/platform/notifications/feed' && s.body.read === 'n2')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeTruthy();
  });
});
