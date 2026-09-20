// @vitest-environment jsdom
/*
 * Phase 11 — recommendation blocks, rendered.
 *
 * The service tests prove what gets recommended; these prove how it reaches
 * the screen: the ordinary <ProductCard> (so a recommendation opens, adds to
 * the bag and shows its price like any product), states that never make the
 * page look broken, a cold start that costs no request, and a failure that
 * leaves the page as it was.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecommendationSection } from './recommendation-section';
import { Recommendations } from './recommendations';
import { StorefrontProvider } from '@/lib/storefront/context';
import { useCartStore } from '@/lib/storefront/stores/cart-store';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import { useRecentlyViewedStore } from '@/lib/storefront/stores/recently-viewed-store';
import { useShoppingActivityStore } from '@/lib/storefront/stores/shopping-activity-store';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { clearRecommendationCache } from '@/lib/storefront/recommendations/use-recommendations';
import { formatMoney } from '@/lib/storefront/format';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import type { Product } from '@/lib/storefront/types';
import type { RecommendationResponse } from '@/lib/storefront/recommendations/types';

vi.mock('next/image', () => ({
  default: ({ src, alt, fill, priority, sizes, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={String(alt ?? '')} {...(rest as object)} />
  ),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

const SIMPLE = PRODUCTS.filter((p) => p.options.length === 0 && p.inStock && p.variants[0].stock > 3);

const response = (products: Product[], strategy: RecommendationResponse['strategy']): RecommendationResponse => ({
  placement: 'homepage',
  items: products.map((product, i) => ({
    product,
    rank: i + 1,
    score: 10 - i,
    strategy: strategy ?? 'popular',
    reason: { kind: 'popular', label: 'Popular in this store' },
  })),
  total: products.length,
  strategy,
  degraded: false,
});

const renderIn = (ui: React.ReactNode) =>
  render(
    <StorefrontProvider org={{ slug: 'demo', name: 'Demo', logoUrl: null }} isMobileRuntime={false}>
      {ui}
    </StorefrontProvider>,
  );

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  clearRecommendationCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useCartStore.setState({ items: [], savedForLater: [], coupon: null, hydrated: true });
  useWishlistStore.setState({ items: [], hydrated: true });
  useRecentlyViewedStore.setState({ ids: [] });
  useShoppingActivityStore.setState({ events: [] });
  useUIStore.setState({ overlay: null });
});

afterEach(cleanup);

/* ───────────────────────── presentational section ────────────────────── */

describe('RecommendationSection', () => {
  const products = SIMPLE.slice(0, 3);
  const items = products.map((product) => ({ product, reason: 'Similar to this product' }));

  it('renders a titled rail of ordinary product cards', () => {
    renderIn(<RecommendationSection id="for-you" title="You may also like" subtitle="Closest matches" items={items} />);

    const section = screen.getByRole('region', { name: 'You may also like' });
    expect(within(section).getByText('Closest matches')).toBeDefined();
    expect(within(section).getAllByRole('article')).toHaveLength(3);
    // Behaves like any product: links to its PDP and shows its real price.
    const firstLinks = within(section).getAllByRole('link', { name: new RegExp(products[0].name) });
    expect(firstLinks[0].getAttribute('href')).toBe(`/products/${products[0].slug}`);
    expect(within(section).getAllByText(formatMoney(products[0].priceFrom, products[0].currency)).length).toBeGreaterThan(0);
  });

  it('shows skeletons in the rail’s own footprint while loading', () => {
    const { container } = renderIn(<RecommendationSection title="Recommended for you" items={[]} loading />);
    const section = container.querySelector('section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Recommended for you' })).toBeDefined();
    expect(container.querySelectorAll('li[aria-hidden]')).toHaveLength(4);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('renders nothing on error — never a broken block', () => {
    const { container } = renderIn(<RecommendationSection title="Recommended for you" items={items} error />);
    expect(container.querySelector('section')).toBeNull();
  });

  it('renders nothing when empty — never "0 recommendations"', () => {
    const { container } = renderIn(<RecommendationSection title="Recommended for you" items={[]} />);
    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent).not.toMatch(/0 recommendations/i);
  });

  it('reports a product click with its rank, but not button presses on the card', async () => {
    const user = userEvent.setup();
    const onProductClick = vi.fn();
    renderIn(<RecommendationSection title="You may also like" items={items} onProductClick={onProductClick} />);

    const second = screen.getAllByRole('article')[1];
    const link = within(second).getAllByRole('link')[0];
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(onProductClick).toHaveBeenCalledWith(products[1], 2);

    onProductClick.mockClear();
    await user.click(within(second).getByRole('button', { name: /^Add .* to bag$/ }));
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it('adds a recommended product to the bag exactly like any other card', async () => {
    const user = userEvent.setup();
    renderIn(<RecommendationSection title="Complete your order" items={items} />);

    await user.click(within(screen.getAllByRole('article')[0]).getByRole('button', { name: /^Add .* to bag$/ }));
    expect(useCartStore.getState().items.map((i) => i.productId)).toEqual([products[0].id]);
  });

  it('is a horizontally scrolling, snap-aligned rail on mobile with readable card widths', () => {
    const { container } = renderIn(<RecommendationSection title="You may also like" items={items} />);
    const rail = container.querySelector('ul');
    expect(rail?.className).toMatch(/overflow-x-auto/);
    expect(rail?.className).toMatch(/snap-x/);
    for (const li of container.querySelectorAll('ul > li')) {
      expect(li.className).toMatch(/w-\[45vw\]/);
      expect(li.className).toMatch(/shrink-0/);
    }
  });

  it('only shows per-card reasons when asked to', () => {
    const { rerender } = renderIn(<RecommendationSection title="t" items={items} />);
    expect(screen.queryAllByText('Similar to this product')).toHaveLength(0);
    rerender(
      <StorefrontProvider org={{ slug: 'demo', name: 'Demo', logoUrl: null }} isMobileRuntime={false}>
        <RecommendationSection title="t" items={items} showReasons />
      </StorefrontProvider>,
    );
    expect(screen.getAllByText('Similar to this product')).toHaveLength(3);
  });
});

/* ───────────────────────────── container ─────────────────────────────── */

describe('<Recommendations>', () => {
  it('cold start: paints the server response with no request at all', async () => {
    renderIn(<Recommendations placement="homepage" initial={response(SIMPLE.slice(0, 2), 'popular')} />);

    expect(screen.getByRole('heading', { name: 'Recommended for you' })).toBeDefined();
    expect(screen.getByText(/popular picks/i)).toBeDefined();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refines with session signals once there are some, sending ids — not products', async () => {
    const viewed = SIMPLE[5];
    useRecentlyViewedStore.setState({ ids: [viewed.id] });
    const refined = response(SIMPLE.slice(2, 5), 'personalized');
    fetchMock.mockResolvedValue(new Response(JSON.stringify(refined), { status: 200 }));

    renderIn(<Recommendations placement="homepage" initial={response(SIMPLE.slice(0, 2), 'popular')} />);

    await waitFor(() => expect(screen.getByText(/picked from what you’ve been browsing/i)).toBeDefined());
    expect(screen.getAllByRole('article')).toHaveLength(3);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/storefront/recommendations');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ org: 'demo', placement: 'homepage' });
    expect(body.context.signals.recentlyViewedIds).toEqual([viewed.id]);
    expect(JSON.stringify(body)).not.toContain(viewed.name);
  });

  it('keeps the server block when refinement fails', async () => {
    useRecentlyViewedStore.setState({ ids: [SIMPLE[5].id] });
    fetchMock.mockRejectedValue(new Error('offline'));

    renderIn(<Recommendations placement="homepage" initial={response(SIMPLE.slice(0, 2), 'popular')} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('hides a client-only block entirely when its request fails', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const { container } = renderIn(<Recommendations placement="cart" />);

    expect(container.querySelector('section[aria-busy]')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  it('titles the bag block by what filled it', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...response(SIMPLE.slice(0, 2), 'contextual'), placement: 'cart' })),
    );
    renderIn(<Recommendations placement="cart" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Complete your order' })).toBeDefined());

    cleanup();
    clearRecommendationCache();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...response(SIMPLE.slice(0, 2), 'popular'), placement: 'cart' })),
    );
    renderIn(<Recommendations placement="cart" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'You might also like' })).toBeDefined());
  });

  it('hides a block below its minimum instead of showing a thin rail', () => {
    const { container } = renderIn(
      <Recommendations placement="search" minItems={4} initial={response(SIMPLE.slice(0, 2), 'contextual')} />,
    );
    expect(container.querySelector('section')).toBeNull();
  });

  it('records a recommendation click as a shopping event', async () => {
    const user = userEvent.setup();
    renderIn(<Recommendations placement="homepage" initial={response(SIMPLE.slice(0, 2), 'popular')} />);

    const link = within(screen.getAllByRole('article')[0]).getAllByRole('link')[0];
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);

    expect(useShoppingActivityStore.getState().events).toEqual([
      expect.objectContaining({
        name: 'recommendation_clicked',
        productId: SIMPLE[0].id,
        placement: 'homepage',
        rank: 1,
      }),
    ]);
  });

  it('shares one request between identical blocks', async () => {
    useRecentlyViewedStore.setState({ ids: [SIMPLE[5].id] });
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response(SIMPLE.slice(0, 3), 'personalized'))));

    renderIn(
      <>
        <Recommendations placement="homepage" initial={response(SIMPLE.slice(0, 2), 'popular')} />
        <Recommendations placement="homepage" initial={response(SIMPLE.slice(0, 2), 'popular')} />
      </>,
    );

    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(6));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
