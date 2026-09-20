// @vitest-environment jsdom
/*
 * Renders the real results surface over the real fixture catalogue.
 *
 * The point is to exercise what the unit tests can't: that the service's
 * output actually drives a working UI — filters that navigate, chips that
 * remove the right thing, a pager that keeps state, and a grid that shows
 * the products the query returned.
 */
import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogView } from './catalog-view';
import { pageWindow } from './pagination';
import { loadDiscoveryPage } from '@/lib/storefront/product-discovery';
import { StorefrontProvider } from '@/lib/storefront/context';

vi.mock('next/link', () => ({
  default: ({ children, href, scroll, ...rest }: React.ComponentProps<'a'> & { scroll?: boolean }) => (
    <a href={String(href)} {...rest}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, fill, priority, sizes, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={String(alt ?? '')} {...(rest as object)} />
  ),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/search',
}));

/** Drive the page exactly as the route does: from a URL. */
async function renderUrl(url: string, defaults = {}) {
  const { pathname, searchParams } = new URL(url, 'https://shop.demo.test');
  const rawParams = Object.fromEntries([...searchParams.keys()].map((k) => [k, searchParams.getAll(k)]));
  const page = await loadDiscoveryPage({
    organizationSlug: 'demo',
    rawParams,
    pathname,
    defaults,
  });

  render(
    <StorefrontProvider org={{ slug: 'demo', name: 'Demo', logoUrl: null }} isMobileRuntime={false}>
      <CatalogView
        view={page.view}
        pathname={pathname}
        emptyState={page.emptyState}
        emptyCategories={page.emptyCategories}
        title="Results"
      />
    </StorefrontProvider>,
  );
  return page;
}

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe('21. responsive product grid', () => {
  it('renders a card per result, with a stable image box to avoid layout shift', async () => {
    const page = await renderUrl('/search?q=dress');
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(page.view.result.items.length);
    expect(cards.length).toBeGreaterThan(0);
    // Every card names a product that the service actually returned.
    const names = page.view.result.items.map((p) => p.name);
    expect(within(cards[0]).getByText(names[0])).toBeTruthy();
  });

  it('links a result through to its product detail page', async () => {
    const page = await renderUrl('/search?q=kettlebell');
    const slug = page.view.result.items[0].slug;
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain(`/products/${slug}`);
  });
});

describe('9/10. active filter chips', () => {
  it('shows a chip per filter, each removing only itself', async () => {
    await renderUrl('/search?q=coat&colour=black&stock=1');

    const blackChip = screen.getByRole('link', { name: /^Black/ });
    const href = blackChip.getAttribute('href')!;
    expect(href).toContain('q=coat');
    expect(href).toContain('stock=1');
    expect(href).not.toContain('colour=');

    const stockChip = screen.getByRole('link', { name: /^In stock/ });
    expect(stockChip.getAttribute('href')).toContain('colour=black');
  });

  it('offers clear-all that keeps the query', async () => {
    await renderUrl('/search?q=coat&colour=black&stock=1');
    const clear = screen.getAllByRole('link', { name: 'Clear all' })[0];
    expect(clear.getAttribute('href')).toBe('/search?q=coat');
  });
});

describe('7/19/20. filter controls write to the URL', () => {
  it('a brand checkbox navigates with the brand applied', async () => {
    const page = await renderUrl('/c/fashion', { categoryPath: ['fashion'] });
    const brand = page.view.result.facets.brands[0];

    const user = userEvent.setup();
    // The desktop sidebar and the mobile sheet share one panel component, so
    // the first match is the sidebar's instance.
    await user.click(screen.getAllByRole('checkbox', { name: new RegExp(brand.label) })[0]);

    expect(push).toHaveBeenCalled();
    expect(push.mock.calls[0][0]).toContain(`brand=${brand.value}`);
  });

  it('a price preset navigates with a price bound', async () => {
    await renderUrl('/products');
    const user = userEvent.setup();
    const preset = screen.getAllByRole('button', { name: /^Under / })[0];
    await user.click(preset);
    expect(push.mock.calls[0][0]).toMatch(/maxPrice=\d+/);
  });

  it('only renders option facets the current results have', async () => {
    await renderUrl('/c/beauty', { categoryPath: ['beauty'] });
    expect(screen.queryByRole('button', { name: /^Storage/ })).toBeNull();
    cleanup();
    await renderUrl('/c/electronics', { categoryPath: ['electronics'] });
    expect(screen.getAllByText('Storage').length).toBeGreaterThan(0);
  });
});

describe('11-14. sorting', () => {
  it('reflects the URL and navigates on change without losing the query', async () => {
    await renderUrl('/search?q=dress&sort=price-asc');
    const select = screen.getByLabelText('Sort products') as HTMLSelectElement;
    expect(select.value).toBe('price-asc');

    await userEvent.setup().selectOptions(select, 'rating');
    expect(push).toHaveBeenCalled();
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain('q=dress');
    expect(href).toContain('sort=rating');
  });
});

describe('16/17. pagination keeps URL state', () => {
  it('links each page with the query and sort intact', async () => {
    await renderUrl('/products?sort=price-asc');
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    const page2 = within(nav).getByRole('link', { name: 'Page 2' });
    expect(page2.getAttribute('href')).toContain('sort=price-asc');
    expect(page2.getAttribute('href')).toContain('page=2');
  });

  it('marks the current page and windows long page lists', async () => {
    await renderUrl('/products?sort=price-asc&page=3');
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).getByRole('link', { name: 'Page 3' }).getAttribute('aria-current')).toBe('page');
    expect(pageWindow(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('23. empty state', () => {
  it('names the query, offers only working recoveries and real categories', async () => {
    await renderUrl('/search?q=blue+gaming+refrigerator');
    expect(screen.getByText(/No results for/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Clear filters/ })).toBeNull();
    expect(screen.getByText('Browse categories')).toBeTruthy();
  });

  it('offers filter removal when that genuinely recovers results', async () => {
    await renderUrl('/search?q=dress&maxPrice=1');
    const recover = screen.getByRole('link', { name: /^Clear filters \(\d+\)/ });
    expect(recover.getAttribute('href')).toBe('/search?q=dress');
  });
});

describe('18. category browsing', () => {
  it('renders subcategory links for the department', async () => {
    const page = await renderUrl('/c/fashion', { categoryPath: ['fashion'] });
    const nav = screen.getByRole('navigation', { name: 'Subcategories' });
    const links = within(nav).getAllByRole('link');
    expect(links.length).toBe(page.view.childCategories.length);
    expect(links[0].getAttribute('href')).toMatch(/^\/c\/fashion\//);
  });
});

describe('19. mobile filters', () => {
  it('opens the filter sheet, applies a filter and closes itself', async () => {
    await renderUrl('/c/fashion', { categoryPath: ['fashion'] });
    const user = userEvent.setup();

    // The sheet's contents are not mounted until it opens.
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Filters')).toBeTruthy();

    // Applying from inside the sheet navigates and dismisses, so the shopper
    // sees the effect instead of being left staring at the panel.
    await user.click(within(sheet).getAllByRole('checkbox')[0]);
    expect(push).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the active filter count on the trigger', async () => {
    await renderUrl('/c/fashion?colour=black&stock=1', { categoryPath: ['fashion'] });
    const trigger = screen.getByRole('button', { name: /^Filters/ });
    expect(within(trigger).getByText('2')).toBeTruthy();
  });

  it('lets the sheet clear everything in one action', async () => {
    await renderUrl('/c/fashion?colour=black&stock=1', { categoryPath: ['fashion'] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Clear all' }));
    expect(push).toHaveBeenCalledWith('/c/fashion', { scroll: false });
  });
});

describe('partial-match honesty', () => {
  it('says so rather than passing widened results off as exact', async () => {
    const page = await renderUrl('/search?q=wireless+mouse+sneaker');
    if (page.view.result.search?.partial && page.view.result.total > 0) {
      expect(screen.getByText(/closest matches/)).toBeTruthy();
    }
  });
});
