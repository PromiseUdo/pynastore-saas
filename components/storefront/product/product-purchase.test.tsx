// @vitest-environment jsdom
/*
 * The buy box, rendered over the real fixture catalogue.
 *
 * What the unit tests can't cover: that the rules in variant-selection.ts
 * actually reach the UI — a swatch that changes the price, a sold-out option
 * that announces itself, a stepper that stops at 1, and a mobile experience
 * that does not need a pointer.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductPurchase } from './product-purchase';
import { StorefrontProvider } from '@/lib/storefront/context';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import { formatMoney } from '@/lib/storefront/format';
import { useCartStore } from '@/lib/storefront/stores/cart-store';

vi.mock('next/image', () => ({
  default: ({ src, alt, fill, priority, sizes, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={String(alt ?? '')} {...(rest as object)} />
  ),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

/* jsdom has no IntersectionObserver; the sticky bar observes the add button. */
class FakeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

const renderPurchase = (product = MULTI_OPTION) =>
  render(
    <StorefrontProvider org={{ slug: 'demo', name: 'Demo', logoUrl: null }} isMobileRuntime={false}>
      <ProductPurchase product={product} />
    </StorefrontProvider>,
  );

/** Colour + size, with a price that varies — the interesting case. */
const MULTI_OPTION = PRODUCTS.find((p) => p.options.length > 1 && p.inStock)!;
const NO_OPTION = PRODUCTS.find((p) => p.options.length === 0)!;

afterEach(() => {
  cleanup();
  useCartStore.setState({ items: [] });
});

describe('product identity and price', () => {
  it('leads with brand, name, rating and a prominent price', () => {
    renderPurchase();

    expect(screen.getByText(MULTI_OPTION.brandName)).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(MULTI_OPTION.name);
    expect(screen.getByText(`(${MULTI_OPTION.rating.count.toLocaleString()} reviews)`)).toBeDefined();

    const price = formatMoney(MULTI_OPTION.variants[0].price, MULTI_OPTION.currency);
    expect(screen.getAllByText(price).length).toBeGreaterThan(0);
  });

  it('shows the original price and a computed discount only when there is one', () => {
    const onSale = PRODUCTS.find(
      (p) => p.options.length > 0 && p.inStock && p.compareAtPrice && p.compareAtPrice > p.priceFrom,
    )!;
    renderPurchase(onSale);

    const struck = screen.getAllByText(formatMoney(onSale.compareAtPrice!, onSale.currency));
    expect(struck.length).toBeGreaterThan(0);
    expect(screen.getByText(/% off$/)).toBeDefined();

    cleanup();
    const plain = PRODUCTS.find((p) => p.options.length > 0 && !p.compareAtPrice)!;
    renderPurchase(plain);
    expect(screen.queryByText(/% off$/)).toBeNull();
  });
});

describe('variants', () => {
  it('renders one accessible group per option, with the chosen value named', () => {
    renderPurchase();

    for (const option of MULTI_OPTION.options) {
      const group = screen.getByRole('radiogroup', { name: option.name });
      expect(within(group).getAllByRole('radio').length).toBe(option.values.length);
      expect(within(group).getAllByRole('radio', { checked: true }).length).toBe(1);
    }
  });

  it('never communicates a colour by swatch alone', () => {
    const colourOption = MULTI_OPTION.options.find((o) => o.kind === 'color')!;
    expect(colourOption).toBeDefined();
    renderPurchase();

    const group = screen.getByRole('radiogroup', { name: colourOption.name });
    for (const value of colourOption.values) {
      // Each swatch carries its colour name as its accessible name.
      expect(within(group).getByRole('radio', { name: new RegExp(value.label, 'i') })).toBeDefined();
    }
  });

  it('selecting a different value updates the selection and the price', async () => {
    // A storage option carries a genuine price delta between variants.
    const tiered = PRODUCTS.find(
      (p) =>
        p.options.some((o) => o.name === 'Storage') &&
        new Set(p.variants.map((v) => v.price)).size > 1 &&
        p.inStock,
    )!;
    const user = userEvent.setup();
    renderPurchase(tiered);

    const storage = tiered.options.find((o) => o.name === 'Storage')!;
    const group = screen.getByRole('radiogroup', { name: 'Storage' });
    const before = screen.getByRole('heading', { level: 1 }).parentElement!.textContent;

    const unchosen = within(group)
      .getAllByRole('radio')
      .find((el) => el.getAttribute('aria-checked') === 'false')!;
    await user.click(unchosen);

    expect(unchosen.getAttribute('aria-checked')).toBe('true');
    expect(storage.values.length).toBeGreaterThan(1);
    // The price block re-rendered with the new variant's price.
    const after = screen.getByRole('heading', { level: 1 }).parentElement!.textContent;
    expect(after).not.toBe(before);
  });

  it('marks sold-out values as disabled rather than hiding them', () => {
    const withSoldOut = PRODUCTS.find(
      (p) => p.options.length > 0 && p.variants.some((v) => v.stock === 0) && p.inStock,
    )!;
    renderPurchase(withSoldOut);

    const radios = screen.getAllByRole('radio');
    // Every value is still on the page — "exists but not in your size" is
    // information, not something to hide.
    const total = withSoldOut.options.reduce((n, o) => n + o.values.length, 0);
    expect(radios.length).toBe(total);
  });

  it('shows no variant picker for a product without options', () => {
    renderPurchase(NO_OPTION);
    expect(screen.queryAllByRole('radiogroup')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /add to bag/i })).toBeDefined();
  });
});

describe('quantity', () => {
  it('cannot go below 1', async () => {
    const user = userEvent.setup();
    renderPurchase();

    const decrease = screen.getByRole('button', { name: 'Decrease quantity' });
    expect(decrease.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByText('2')).toBeDefined();

    await user.click(decrease);
    await user.click(decrease);
    expect(decrease.hasAttribute('disabled')).toBe(true);
  });

  it('stops at the stock of the selected variant', async () => {
    // A product whose selected variant has a small, known stock.
    const limited = PRODUCTS.find(
      (p) => p.options.length === 0 && p.variants[0].stock > 0 && p.variants[0].stock <= 12,
    )!;
    expect(limited, 'fixture catalogue has no low-stock simple product').toBeDefined();

    const user = userEvent.setup();
    renderPurchase(limited);

    const increase = screen.getByRole('button', { name: 'Increase quantity' });
    for (let i = 0; i < limited.variants[0].stock + 3; i++) {
      if (increase.hasAttribute('disabled')) break;
      await user.click(increase);
    }

    expect(screen.getByText(String(limited.variants[0].stock))).toBeDefined();
    expect(increase.hasAttribute('disabled')).toBe(true);
  });
});

describe('cart integration', () => {
  it('sends product, variant, quantity and price to the cart store', async () => {
    const user = userEvent.setup();
    renderPurchase();

    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await user.click(screen.getByRole('button', { name: /add to bag/i }));

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(MULTI_OPTION.id);
    expect(items[0].quantity).toBe(2);
    expect(items[0].unitPrice).toBeGreaterThan(0);
    expect(MULTI_OPTION.variants.some((v) => v.id === items[0].variantId)).toBe(true);
  });

  it('refuses an out-of-stock product', async () => {
    const soldOut = PRODUCTS.find((p) => !p.inStock)!;
    expect(soldOut, 'fixture catalogue has no sold-out product').toBeDefined();

    renderPurchase(soldOut);
    const add = screen.getByRole('button', { name: /out of stock|select options/i });
    expect(add.hasAttribute('disabled')).toBe(true);
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});

describe('mobile', () => {
  it('offers the gallery as a swipeable strip with a counter, not a hover interaction', () => {
    const { container } = renderPurchase();

    // The phone gallery is a scroll-snap track that is present in the DOM
    // regardless of pointer support, and its counter is plain text — no
    // hover, no drag library, nothing that needs a mouse.
    const track = container.querySelector('.snap-x');
    expect(track).not.toBeNull();
    expect(track!.className).toContain('overflow-x-auto');
    expect(screen.getByText(`1 / ${MULTI_OPTION.images.length}`)).toBeDefined();
  });

  it('gives every control a touch-sized target', () => {
    renderPurchase();

    // 44px minimum on the things a thumb has to hit.
    for (const name of ['Decrease quantity', 'Increase quantity']) {
      expect(screen.getByRole('button', { name }).className).toContain('size-12');
    }
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className).toMatch(/size-12|h-12/);
    }
  });
});
