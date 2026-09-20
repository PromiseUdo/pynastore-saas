// @vitest-environment jsdom
/*
 * Autocomplete behaviour. The suggestion payload is stubbed at the fetch
 * boundary (the endpoint itself is covered by the catalog tests) so this can
 * assert the interaction: debouncing, grouping, keyboard navigation, and
 * that choosing a suggestion preserves the filters already applied.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorefrontProvider } from '@/lib/storefront/context';
import { SearchField } from './search-field';
import { EMPTY_CRITERIA, type DiscoveryCriteria } from '@/lib/storefront/discovery-url';
import type { OptionIndex } from '@/lib/storefront/types';

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={String(alt ?? '')} {...(rest as object)} />
  ),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const INDEX: OptionIndex = [
  {
    key: 'colour',
    name: 'Colour',
    kind: 'color',
    source: 'option',
    values: [{ key: 'black', id: 'ov_col_black', label: 'Black' }],
  },
];

const PAYLOAD = {
  terms: ['black shoes'],
  categories: [{ id: 'c1', name: 'Shoes', path: ['fashion', 'shoes'] }],
  brands: [{ id: 'b1', name: 'Northbound', slug: 'northbound' }],
  products: [
    { id: 'p1', slug: 'black-runner', name: 'Black Runner', brand: 'Northbound', image: 'https://x/i.jpg', priceFrom: 5_000_00, currency: 'NGN' },
  ],
};

function setup(criteria: Partial<DiscoveryCriteria> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => PAYLOAD })),
  );
  // Wrapped exactly as the storefront wraps it: the suggestions request has
  // to name its store, which the field reads from this provider.
  render(
    <StorefrontProvider org={{ slug: 'test-store', name: 'Test Store', logoUrl: null }} isMobileRuntime={false}>
      <SearchField
        criteria={{ ...EMPTY_CRITERIA, ...criteria }}
        optionIndex={INDEX}
        pathname="/search"
      />
    </StorefrontProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe('20. search autocomplete', () => {
  it('stays quiet under two characters, then suggests', async () => {
    setup();
    const user = userEvent.setup();
    const input = screen.getByLabelText('Search the store');

    await user.type(input, 'b');
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.type(input, 'la');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
  });

  it('groups products, categories and brands', async () => {
    setup();
    await userEvent.setup().type(screen.getByLabelText('Search the store'), 'bla');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    expect(screen.getByText('Suggestions')).toBeTruthy();
    expect(screen.getByText('Categories')).toBeTruthy();
    expect(screen.getByText('Brands')).toBeTruthy();
    expect(screen.getByText('Products')).toBeTruthy();
    expect(screen.getByText('Black Runner')).toBeTruthy();
  });

  it('navigates suggestions with the arrow keys and opens on Enter', async () => {
    setup();
    const user = userEvent.setup();
    const input = screen.getByLabelText('Search the store');
    await user.type(input, 'bla');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1);

    await user.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/search?q=black+shoes');
  });

  it('a product suggestion goes straight to the product', async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search the store'), 'bla');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    await user.click(screen.getByText('Black Runner'));
    expect(push).toHaveBeenCalledWith('/products/black-runner');
  });

  it('refining the query keeps the filters already applied', async () => {
    setup({ optionValueIds: ['ov_col_black'], sort: 'price-asc' });
    const user = userEvent.setup();
    const input = screen.getByLabelText('Search the store');

    await user.type(input, 'coat{Enter}');

    const href = push.mock.calls[0][0] as string;
    expect(href).toContain('q=coat');
    expect(href).toContain('colour=black');
    expect(href).toContain('sort=price-asc');
  });

  it('is seeded from the URL so the box matches the results below it', () => {
    setup({ q: 'wool coat' });
    expect((screen.getByLabelText('Search the store') as HTMLInputElement).value).toBe('wool coat');
  });
});
