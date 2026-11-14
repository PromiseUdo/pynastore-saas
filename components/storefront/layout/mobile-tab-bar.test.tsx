// @vitest-environment jsdom
/*
 * The phone's bottom navigation (ROADMAP 16.5). On a phone the header is only
 * a search box and there is no footer, so this bar must be there on the web
 * as well as in the app, and Account must be one of its tabs.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StorefrontProvider } from '@/lib/storefront/context';
import { MobileTabBar } from './mobile-tab-bar';
import { ChatConfigProvider } from '@/components/storefront/chat/chat-config';

const pathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const ORG = { slug: 'acme', name: 'Acme', logoUrl: null };

function renderBar(isMobileRuntime: boolean, { chat = false }: { chat?: boolean } = {}) {
  return render(
    <StorefrontProvider org={ORG} isMobileRuntime={isMobileRuntime}>
      <ChatConfigProvider value={chat ? { greeting: null, exists: false, unread: 0 } : null}>
        <MobileTabBar />
      </ChatConfigProvider>
    </StorefrontProvider>,
  );
}

/** The tabs in the order they sit on screen. */
const tabNames = () => [...screen.getByRole('navigation').children].map((el) => el.textContent?.replace(/—.*/, '').trim());

afterEach(cleanup);

describe('MobileTabBar', () => {
  it('shows on a phone browser, not only in the app', () => {
    renderBar(false);
    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it('has Home, Shop, Bag, Messages and Account — Saved is under Account, Search is the header', () => {
    renderBar(true, { chat: true });
    const names = tabNames();
    expect(names).toEqual(['Home', 'Shop', 'Bag', 'Messages', 'Account']);
    expect(names).not.toContain('Saved');
    expect(names).not.toContain('Search');
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account/menu');
  });

  it('leaves Messages out while the shop doesn’t take messages', () => {
    renderBar(true);
    expect(tabNames()).toEqual(['Home', 'Shop', 'Bag', 'Account']);
  });

  it('marks Account as current anywhere under /account', () => {
    pathname.value = '/store/acme/account/orders';
    renderBar(true);
    expect(screen.getByRole('link', { name: 'Account' }).className).toContain('text-brand');
    pathname.value = '/';
  });
});
