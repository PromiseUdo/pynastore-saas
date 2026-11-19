// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StorefrontProvider } from '@/lib/storefront/context';
import { useAssistantStore } from '@/lib/storefront/stores/assistant-store';
import { useGuidedStore } from '@/lib/storefront/stores/guided-store';
import { ShopHelperDock, seedForPath } from './shop-helper-dock';

const pathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const DEPARTMENTS = [{ id: 'c1', name: 'Women', path: ['women'], productCount: 4 }];
const BUDGETS = [{ id: 'b1', label: 'Under ₦20,000', maxPrice: 20000, productCount: 2 }];

function wrap(aiShopping = true, categories = DEPARTMENTS) {
  return render(
    <StorefrontProvider org={{ slug: 'aura', name: 'Aura', logoUrl: null, aiShopping }} isMobileRuntime={false} shopper={null}>
      <ShopHelperDock categories={categories} priceBands={BUDGETS} />
    </StorefrontProvider>,
  );
}

const toggle = () => screen.getByRole('button', { name: /shopping help/i });

beforeEach(() => {
  pathname.value = '/';
  useGuidedStore.setState({ open: false });
});
afterEach(cleanup);

describe('ShopHelperDock', () => {
  it('starts as one closed button, and opens into the three helpers', () => {
    wrap();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('list', { hidden: true }).hasAttribute('inert')).toBe(true);

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Ask about products/ })).toBeTruthy();
    expect(screen.getByText('Instant answers about what we sell')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Search by image/ }).getAttribute('href')).toBe('/search/image');
    expect(screen.getByRole('button', { name: /Help me choose/ })).toBeTruthy();
  });

  it('closes on Escape and on a tap outside', () => {
    wrap();
    fireEvent.click(toggle());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle());
    fireEvent.pointerDown(document.body);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens "Help me choose" as a modal, and closes the list', async () => {
    wrap();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /Help me choose/ }));
    expect(useGuidedStore.getState().open).toBe(true);
    const dialog = await screen.findByRole('dialog');
    // The page behind a modal is hidden from screen readers, the button too.
    expect(screen.getByRole('button', { name: /shopping help/i, hidden: true }).getAttribute('aria-expanded')).toBe('false');
    expect(dialog.textContent).toContain('Which department?');
    expect(dialog.textContent).toContain('Women');
  });

  it('answers the three questions with results inside the modal, and can start over', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ products: [], total: 0, recognised: [], mission: null }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    wrap();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /Help me choose/ }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: /Women/ }));
    fireEvent.click(screen.getByRole('button', { name: /Best value/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Under ₦20,000' }));

    expect(await screen.findByText(/No matches for Women · Best value · Under ₦20,000/)).toBeTruthy();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ org: 'aura', q: 'women', sort: 'price-asc', maxPrice: 20000 });
    expect(dialog.isConnected).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText('Which department?')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('asks the assistant about the product on screen', () => {
    pathname.value = '/products/oud-noir';
    const openPanel = vi.fn();
    useAssistantStore.setState({ openPanel });
    wrap();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /Ask about products/ }));
    expect(openPanel).toHaveBeenCalledWith({ surface: 'product', productSlug: 'oud-noir' }, 'aura');
  });

  it('offers only "Help me choose" when the plan has no AI shopping, and nothing with nothing to offer', () => {
    wrap(false);
    fireEvent.click(toggle());
    expect(screen.queryByRole('button', { name: /Ask about products/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Search by image/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Help me choose/ })).toBeTruthy();
    cleanup();

    wrap(false, []);
    expect(screen.queryByRole('button', { name: /shopping help/i })).toBeNull();
  });
});

describe('seedForPath', () => {
  it('reads where the shopper is from the address', () => {
    expect(seedForPath('/')).toEqual({ surface: 'home' });
    expect(seedForPath('/s/aura/products/oud')).toEqual({ surface: 'product', productSlug: 'oud' });
    expect(seedForPath('/c/women/eau-de-parfum')).toEqual({ surface: 'category', categoryPath: ['women', 'eau-de-parfum'] });
    expect(seedForPath('/search', '?q=vanilla')).toEqual({ surface: 'search', searchQuery: 'vanilla' });
    expect(seedForPath('/cart')).toEqual({ surface: 'cart' });
    expect(seedForPath('/search/image')).toEqual({ surface: 'home' });
  });
});
