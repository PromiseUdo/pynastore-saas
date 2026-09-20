// @vitest-environment jsdom
/*
 * The bag, rendered.
 *
 * The unit tests in lib/storefront/cart.test.ts prove the rules; this proves
 * they reach the screen — that two sizes of one shoe are two rows, that the
 * stepper writes back to the store the header badge reads, that removing a
 * line removes a row, and that an empty bag invites rather than apologises.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartView } from './cart-view';
import { ProductCard } from '@/components/storefront/product/product-card';
import { MiniCart } from '@/components/storefront/layout/mini-cart';
import { StorefrontProvider } from '@/lib/storefront/context';
import { useCartStore, useCartCount } from '@/lib/storefront/stores/cart-store';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { lineKey, toCartLine } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';
import { PRODUCTS } from '@/lib/storefront/mock/products';

vi.mock('next/image', () => ({
  default: ({ src, alt, fill, priority, sizes, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={String(alt ?? '')} {...(rest as object)} />
  ),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

/* Discount codes belong to the merchant and are checked on the server; the
 * bag only offers the field and shows what the answer was worth. */
const applyDiscountCodeAction = vi.fn(async (input: unknown) => {
  const { code } = input as { code: string };
  return code === 'SAVE10'
    ? { ok: true as const, coupon: { code: 'SAVE10', label: '10% off', kind: 'percent' as const, value: 10, minSubtotal: null } }
    : { ok: false as const, message: 'That code isn’t valid.' };
});
vi.mock('@/features/shop-orders/actions', () => ({
  applyDiscountCodeAction: (input: unknown) => applyDiscountCodeAction(input),
  placeOrderAction: vi.fn(),
  payForOrderAction: vi.fn(),
  payForMyOrderAction: vi.fn(),
  quoteDeliveryAction: vi.fn(),
}));

/* The bag checks itself against the catalogue on open; that lookup is the
 * subject of its own tests, so here it simply never answers. */
vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

const MULTI = PRODUCTS.find((p) => p.options.length > 0 && p.variants.filter((v) => v.stock > 2).length >= 2)!;
const SIMPLE = PRODUCTS.find((p) => p.options.length === 0 && p.variants[0]?.stock > 3)!;

const renderIn = (ui: React.ReactNode) =>
  render(
    <StorefrontProvider org={{ slug: 'demo', name: 'Demo', logoUrl: null }} isMobileRuntime={false}>
      {ui}
    </StorefrontProvider>,
  );

function addSimple(quantity = 1) {
  useCartStore.getState().addItem(toCartLine(SIMPLE, SIMPLE.variants[0].id)!, quantity);
}

beforeEach(() => {
  useCartStore.setState({ items: [], savedForLater: [], coupon: null, hydrated: true });
  useUIStore.setState({ overlay: null });
});

afterEach(cleanup);

describe('cart page', () => {
  it('invites rather than apologises when the bag is empty', () => {
    renderIn(<CartView />);

    expect(screen.getByRole('heading', { name: /your bag is empty/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /continue shopping/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /explore collections/i })).toBeDefined();
  });

  it('shows a line per item with its options, unit price and line total', () => {
    addSimple(2);
    renderIn(<CartView />);

    const row = screen.getByRole('listitem');
    expect(within(row).getByRole('link', { name: SIMPLE.name })).toBeDefined();
    expect(within(row).getByText(`${formatMoney(SIMPLE.variants[0].price, SIMPLE.currency)} each`)).toBeDefined();
    expect(within(row).getByText(formatMoney(SIMPLE.variants[0].price * 2, SIMPLE.currency))).toBeDefined();
  });

  it('keeps two variants of the same product as two rows', () => {
    const [a, b] = MULTI.variants.filter((v) => v.stock > 0);
    useCartStore.getState().addItem(toCartLine(MULTI, a.id)!, 1);
    useCartStore.getState().addItem(toCartLine(MULTI, b.id)!, 1);

    renderIn(<CartView />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('steps the quantity through the store and updates the totals', async () => {
    const user = userEvent.setup();
    addSimple(1);
    renderIn(<CartView />);

    await user.click(screen.getByRole('button', { name: /increase quantity/i }));

    const key = lineKey({ productId: SIMPLE.id, variantId: SIMPLE.variants[0].id });
    expect(useCartStore.getState().getItem(key)?.quantity).toBe(2);
    // The line total follows the stepper (it is also the subtotal here).
    const row = screen.getByRole('listitem');
    expect(
      within(row).getByText(formatMoney(SIMPLE.variants[0].price * 2, SIMPLE.currency)),
    ).toBeDefined();
  });

  it('will not step a quantity below 1 — removing is its own button', async () => {
    const user = userEvent.setup();
    addSimple(1);
    renderIn(<CartView />);

    const decrease = screen.getByRole('button', { name: /decrease quantity/i });
    expect(decrease.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: /remove .* from your bag/i }));
    expect(useCartStore.getState().items).toEqual([]);
    expect(screen.getByRole('heading', { name: /your bag is empty/i })).toBeDefined();
  });

  it('asks before clearing a bag, then clears it', async () => {
    const user = userEvent.setup();
    addSimple(2);
    renderIn(<CartView />);

    await user.click(screen.getByRole('button', { name: /clear bag/i }));
    expect(screen.getByRole('alertdialog')).toBeDefined();

    await user.click(screen.getByRole('button', { name: /^clear bag$/i }));
    expect(useCartStore.getState().items).toEqual([]);
  });

  it('summarises the order from the same state the lines render', () => {
    addSimple(2);
    renderIn(<CartView />);

    const summary = screen.getByRole('region', { name: /order summary/i });
    expect(within(summary).getByText(/subtotal \(2 items\)/i)).toBeDefined();
    // Subtotal and total coincide once delivery is free — both are printed.
    expect(
      within(summary).getAllByText(formatMoney(useCartStore.getState().subtotal(), SIMPLE.currency)).length,
    ).toBeGreaterThan(0);
    expect(within(summary).getByRole('link', { name: /checkout/i })).toBeDefined();
  });
});

describe('mini cart', () => {
  it('reflects the same bag the page does', () => {
    addSimple(3);
    useUIStore.setState({ overlay: 'cart' });
    renderIn(<MiniCart />);

    expect(screen.getByText(SIMPLE.name)).toBeDefined();
    expect(screen.getAllByText(formatMoney(SIMPLE.variants[0].price * 3, SIMPLE.currency)).length).toBeGreaterThan(0);
  });

  it('removes a line from the drawer', async () => {
    const user = userEvent.setup();
    addSimple(1);
    useUIStore.setState({ overlay: 'cart' });
    renderIn(<MiniCart />);

    await user.click(screen.getByRole('button', { name: /remove .* from bag/i }));
    expect(useCartStore.getState().items).toEqual([]);
  });
});

describe('header badge', () => {
  function Badge() {
    return <span data-testid="badge">{useCartCount()}</span>;
  }

  it('counts units and follows the store', async () => {
    const user = userEvent.setup();
    render(<Badge />);
    expect(screen.getByTestId('badge').textContent).toBe('0');

    await user.click(document.body); // settle
    addSimple(2);
    await vi.waitFor(() => expect(screen.getByTestId('badge').textContent).toBe('2'));

    useCartStore.getState().addItem(toCartLine(MULTI, MULTI.variants[0].id)!, 1);
    await vi.waitFor(() => expect(screen.getByTestId('badge').textContent).toBe('3'));
  });
});

describe('product card', () => {
  it('adds a single-variant product straight to the bag', async () => {
    const user = userEvent.setup();
    renderIn(<ProductCard product={SIMPLE} />);

    await user.click(screen.getByRole('button', { name: new RegExp(`add ${SIMPLE.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to bag`, 'i') }));
    expect(useCartStore.getState().count()).toBe(1);
  });

  it('sends a product with options to quick view instead of guessing one', async () => {
    const user = userEvent.setup();
    renderIn(<ProductCard product={MULTI} />);

    await user.click(screen.getByRole('button', { name: /choose options/i }));
    expect(useCartStore.getState().items).toEqual([]);
    expect(useUIStore.getState().quickViewSlug).toBe(MULTI.slug);
  });
});

/* ---------------- discount codes ---------------- */

describe('discount code', () => {
  it('takes a code and shows the saving on the summary', async () => {
    const user = userEvent.setup();
    addSimple(2);
    renderIn(<CartView />);

    await user.type(screen.getByLabelText('Discount code'), 'save10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await vi.waitFor(() => expect(screen.getByText('SAVE10')).toBeDefined());
    // Typed lower case; the store's code is what's sent and what's shown.
    expect(applyDiscountCodeAction).toHaveBeenCalledWith(expect.objectContaining({ code: 'SAVE10' }));

    const subtotal = useCartStore.getState().subtotal();
    expect(screen.getByText(`−${formatMoney(Math.round(subtotal / 10))}`)).toBeDefined();
  });

  it('explains a code it cannot use and keeps the bag at full price', async () => {
    const user = userEvent.setup();
    addSimple(1);
    renderIn(<CartView />);

    await user.type(screen.getByLabelText('Discount code'), 'NOPE');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await vi.waitFor(() => expect(screen.getByText('That code isn’t valid.')).toBeDefined());
    expect(useCartStore.getState().coupon).toBeNull();
  });

  it('lets the shopper take the code back off', async () => {
    const user = userEvent.setup();
    addSimple(2);
    renderIn(<CartView />);

    await user.type(screen.getByLabelText('Discount code'), 'SAVE10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(screen.getByText('SAVE10')).toBeDefined());

    await user.click(screen.getByRole('button', { name: /remove discount code save10/i }));
    expect(useCartStore.getState().coupon).toBeNull();
    expect(screen.getByLabelText('Discount code')).toBeDefined();
  });
});
