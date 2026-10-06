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

const pathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const ORG = { slug: 'acme', name: 'Acme', logoUrl: null };

function renderBar(isMobileRuntime: boolean) {
  return render(
    <StorefrontProvider org={ORG} isMobileRuntime={isMobileRuntime}>
      <MobileTabBar />
    </StorefrontProvider>,
  );
}

afterEach(cleanup);

describe('MobileTabBar', () => {
  it('shows on a phone browser, not only in the app', () => {
    renderBar(false);
    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it('has Home, Shop, Saved, Bag and Account — Search is the header now', () => {
    renderBar(true);
    const names = screen.getAllByRole('link').concat(screen.getAllByRole('button')).map((el) => el.textContent?.trim());
    expect(names).toEqual(expect.arrayContaining(['Home', 'Shop', 'Saved', 'Bag', 'Account']));
    expect(names).not.toContain('Search');
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account/menu');
  });

  it('marks Account as current anywhere under /account', () => {
    pathname.value = '/store/acme/account/orders';
    renderBar(true);
    expect(screen.getByRole('link', { name: 'Account' }).className).toContain('text-brand');
    pathname.value = '/';
  });
});
