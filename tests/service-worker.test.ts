/*
 * The service worker (public/sw.js, ROADMAP 18.3/18.7), run as written in a
 * stand-in for the browser's worker scope:
 *
 *   - a push shows the notification it carries, grouped by its tag;
 *   - a click opens its page in a tab of this site that's already open, or
 *     a new one — and never a page on another site.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://shop-acme.getnotely.io';

type Handler = (event: Record<string, unknown>) => void;

function worker(openTabs: string[] = []) {
  const handlers: Record<string, Handler> = {};
  const windows = openTabs.map((url) => ({
    url,
    focus: vi.fn(async () => undefined),
    navigate: vi.fn(async (to: string) => ({ url: to })),
  }));
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
    navigator: { setAppBadge: vi.fn(async () => undefined), clearAppBadge: vi.fn(async () => undefined) },
  };
  vm.runInNewContext(SOURCE, { self, URL });

  /** Fire an event and wait for what it handed to waitUntil. */
  async function fire(type: string, event: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  }
  return { self, windows, fire };
}

const pushOf = (data: unknown) => ({ data: { json: () => data } });
const clickOn = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });

describe('the service worker', () => {
  it('shows a push with its words and thread, and badges the app', async () => {
    const { self, fire } = worker();
    await fire('push', pushOf({ title: 'Acme', body: 'Order R1 is on its way.', url: `${ORIGIN}/account/orders/R1`, tag: 'order:o1' }));
    expect(self.registration.showNotification).toHaveBeenCalledWith('Acme', {
      body: 'Order R1 is on its way.',
      data: { url: `${ORIGIN}/account/orders/R1` },
      tag: 'order:o1',
      renotify: true,
    });
    expect(self.navigator.setAppBadge).toHaveBeenCalled();
  });

  it('still shows something for a push it can’t read', async () => {
    const { self, fire } = worker();
    await fire('push', { data: { json: () => JSON.parse('not json') } });
    expect(self.registration.showNotification).toHaveBeenCalledWith('New notification', { body: '', data: { url: `${ORIGIN}/` } });
  });

  it('opens the page in a tab of this site that is already open', async () => {
    const { self, windows, fire } = worker(['https://elsewhere.example/', `${ORIGIN}/products`]);
    await fire('notificationclick', clickOn(`${ORIGIN}/account/orders/R1`));
    expect(windows[1].focus).toHaveBeenCalled();
    expect(windows[1].navigate).toHaveBeenCalledWith(`${ORIGIN}/account/orders/R1`);
    expect(windows[0].navigate).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
    expect(self.navigator.clearAppBadge).toHaveBeenCalled();
  });

  it('opens a new tab when none of this site is open', async () => {
    const { self, fire } = worker();
    await fire('notificationclick', clickOn('/chat'));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/chat`);
  });

  it('never opens a page on another site', async () => {
    const { self, fire } = worker();
    await fire('notificationclick', clickOn('https://evil.example/phish'));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
