// @vitest-environment jsdom
/*
 * Checkout with an account.
 *
 * The promise of Part 3 is that a signed-in shopper with a saved address
 * doesn't fill in a delivery form at all — so that is what these drive: the
 * default address preselected, the eight fields absent, and the order
 * carrying the address that was chosen rather than the one that happened to
 * be first. Plus the guest path, which must not have changed at all.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckoutView } from './checkout-view';
import { StorefrontProvider } from '@/lib/storefront/context';
import { useCartStore } from '@/lib/storefront/stores/cart-store';
import { setActiveOrg } from '@/lib/storefront/stores/storage';
import { useCheckoutStore } from '@/lib/storefront/stores/checkout-store';
import { toCartLine } from '@/lib/storefront/cart';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import type { CheckoutAccount } from '@/lib/storefront/checkout/types';
import { PRODUCTS } from '@/lib/storefront/mock/products';

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={String(alt ?? '')} {...(rest as object)} />
  ),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/checkout',
}));

/* The only server action checkout calls; it must never be reached when the
 * shopper picked a saved address or left the box unticked. */
const saveCheckoutAddressAction = vi.fn(async () => true);
vi.mock('@/features/shop-account/address-actions', () => ({
  saveCheckoutAddressAction: (...args: unknown[]) => saveCheckoutAddressAction(...(args as [])),
}));

/* The order itself is written on the server; these tests are about the
 * address that goes with it. */
vi.mock('@/features/shop-orders/actions', () => ({
  placeOrderAction: vi.fn(async () => ({
    ok: true,
    reference: 'ORD-2026-000001',
    confirmationToken: 'token-abc',
    paymentUrl: null,
  })),
}));

vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

const config = await getCheckoutConfig({ organizationSlug: 'demo' });
const SIMPLE = PRODUCTS.find((p) => p.options.length === 0 && p.variants[0]?.stock > 3)!;

const HOME = {
  id: 'addr_home',
  fullName: 'Ada Okoro',
  phone: '+234 801 234 5678',
  line1: '14 Admiralty Way',
  line2: 'Lekki Phase 1',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  postalCode: '106104',
  isDefault: true,
};

const WORK = {
  id: 'addr_work',
  fullName: 'Ada Okoro',
  phone: '+234 802 000 0000',
  line1: '3 Trans Amadi Road',
  city: 'Port Harcourt',
  state: 'Rivers',
  country: 'Nigeria',
};

const account: CheckoutAccount = {
  contact: { firstName: 'Ada', lastName: 'Okoro', email: 'ada@example.com', phone: '+234 801 234 5678' },
  addresses: [HOME, WORK],
};

const renderIn = (ui: React.ReactNode) =>
  render(
    <StorefrontProvider
      org={{ slug: 'demo', name: 'Demo Store', logoUrl: null }}
      isMobileRuntime={false}
    >
      {ui}
    </StorefrontProvider>,
  );

/*
 * Claim the tenant namespace before anything renders.
 *
 * <StorefrontProvider> stamps the active org during its render and re-reads
 * any store that hydrated under a different one (lib/storefront/stores/
 * storage.ts) — which would otherwise empty a bag this file had just filled,
 * on the first render only.
 */
setActiveOrg('demo');

beforeEach(() => {
  saveCheckoutAddressAction.mockClear();
  window.localStorage.clear();
  useCartStore.setState({ items: [], savedForLater: [], coupon: null, hydrated: true });
  useCheckoutStore.getState().reset(config);
  window.scrollTo = vi.fn();
});

/** A bag with something in it — checkout refuses to start without one. */
function addToBag() {
  const variant = SIMPLE.variants.find((v) => v.stock > 2) ?? SIMPLE.variants[0];
  useCartStore.getState().addItem(toCartLine(SIMPLE, variant.id)!, 1);
}

afterEach(cleanup);

describe('a guest', () => {
  it('is offered sign-in, and still gets the ordinary form', () => {
    addToBag();
    renderIn(<CheckoutView config={config} account={null} />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeDefined();
    expect(screen.getByLabelText('Address')).toBeDefined();
    expect(screen.queryByRole('group', { name: /deliver to/i })).toBeNull();
    // Nothing to save an address to.
    expect(screen.queryByLabelText(/save this address/i)).toBeNull();
  });
});

describe('a signed-in shopper with saved addresses', () => {
  it('has their details and default address filled in, and no address form to fill', () => {
    addToBag();
    renderIn(<CheckoutView config={config} account={account} />);

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Ada');
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('ada@example.com');

    const home = screen.getByRole('radio', { name: /14 Admiralty Way/ });
    expect((home as HTMLInputElement).checked).toBe(true);

    // The eight fields simply are not there.
    expect(screen.queryByLabelText('Address')).toBeNull();
    expect(screen.queryByLabelText('City or town')).toBeNull();
  });

  it('reaches delivery without typing an address at all', async () => {
    const user = userEvent.setup();
    addToBag();
    renderIn(<CheckoutView config={config} account={account} />);

    await user.click(screen.getByRole('button', { name: /continue to delivery/i }));
    await screen.findByRole('heading', { name: 'Delivery' });

    expect(useCheckoutStore.getState().address.addressLine1).toBe('14 Admiralty Way');
    expect(useCheckoutStore.getState().address.city).toBe('Lagos');
  });

  it('carries the address that was chosen, not the default', async () => {
    const user = userEvent.setup();
    addToBag();
    renderIn(<CheckoutView config={config} account={account} />);

    await user.click(screen.getByRole('radio', { name: /3 Trans Amadi Road/ }));
    await user.click(screen.getByRole('button', { name: /continue to delivery/i }));
    await screen.findByRole('heading', { name: 'Delivery' });

    const address = useCheckoutStore.getState().address;
    expect(address.addressLine1).toBe('3 Trans Amadi Road');
    expect(address.state).toBe('Rivers');
  });

  it('opens an empty form for somewhere else, and offers to save it', async () => {
    const user = userEvent.setup();
    addToBag();
    renderIn(<CheckoutView config={config} account={account} />);

    await user.click(screen.getByRole('radio', { name: /deliver somewhere else/i }));

    const line1 = screen.getByLabelText('Address') as HTMLInputElement;
    expect(line1.value).toBe('');
    expect(screen.getByLabelText(/save this address to my account/i)).toBeDefined();
  });

  it('goes back to a saved address without keeping what was typed for the other one', async () => {
    const user = userEvent.setup();
    addToBag();
    renderIn(<CheckoutView config={config} account={account} />);

    await user.click(screen.getByRole('radio', { name: /deliver somewhere else/i }));
    await user.type(screen.getByLabelText('Address'), '9 Somewhere Close');
    await user.click(screen.getByRole('radio', { name: /14 Admiralty Way/ }));

    await user.click(screen.getByRole('button', { name: /continue to delivery/i }));
    await screen.findByRole('heading', { name: 'Delivery' });

    expect(useCheckoutStore.getState().address.addressLine1).toBe('14 Admiralty Way');
  });
});

describe('a signed-in shopper with no saved addresses', () => {
  const fresh: CheckoutAccount = { contact: account.contact, addresses: [] };

  it('gets the ordinary form with their details prefilled, and the save box ticked', () => {
    addToBag();
    renderIn(<CheckoutView config={config} account={fresh} />);

    expect(screen.queryByRole('radio', { name: /deliver somewhere else/i })).toBeNull();
    expect(screen.getByLabelText('Address')).toBeDefined();
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Ada');

    const save = screen.getByLabelText(/save this address to my account/i) as HTMLInputElement;
    expect(save.checked).toBe(true);
  });
});

/* ---------------- what gets saved, and when ---------------- */

async function walkToPlaced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /continue to delivery/i }));
  await screen.findByRole('heading', { name: 'Delivery' });
  await user.click(screen.getByRole('radio', { name: /standard delivery/i }));
  await user.click(screen.getByRole('button', { name: /continue to payment/i }));
  await screen.findByRole('heading', { name: 'Payment' });
  await user.click(screen.getByRole('radio', { name: /^pay online/i }));
  await user.click(screen.getByRole('button', { name: /review your order/i }));
  await screen.findByRole('heading', { name: 'Review your order' });
  await user.click(screen.getByRole('button', { name: /place order/i }));
  await waitFor(() => expect(useCheckoutStore.getState().status).toBe('placed'));
}

describe('saving an address from checkout', () => {
  it('does not re-save an address that came from the book', async () => {
    const user = userEvent.setup();
    addToBag();
    renderIn(<CheckoutView config={config} account={account} />);

    await walkToPlaced(user);

    expect(saveCheckoutAddressAction).not.toHaveBeenCalled();
  });

  it('saves a new one when the box is ticked, and only after the order exists', async () => {
    const user = userEvent.setup();
    addToBag();
    renderIn(<CheckoutView config={config} account={account} />);

    await user.click(screen.getByRole('radio', { name: /deliver somewhere else/i }));
    await user.selectOptions(screen.getByLabelText('State'), 'Rivers');
    await user.type(screen.getByLabelText('City or town'), 'Port Harcourt');
    await user.type(screen.getByLabelText('Address'), '9 Somewhere Close');
    await user.click(screen.getByLabelText(/save this address to my account/i));

    expect(saveCheckoutAddressAction).not.toHaveBeenCalled();

    await walkToPlaced(user);

    expect(saveCheckoutAddressAction).toHaveBeenCalledTimes(1);
    expect(saveCheckoutAddressAction).toHaveBeenCalledWith(
      expect.objectContaining({ line1: '9 Somewhere Close', city: 'Port Harcourt', state: 'Rivers' }),
    );
  });

  it('respects an unticked box', async () => {
    const user = userEvent.setup();
    addToBag();
    renderIn(<CheckoutView config={config} account={{ ...account, addresses: [] }} />);

    await user.selectOptions(screen.getByLabelText('State'), 'Rivers');
    await user.type(screen.getByLabelText('City or town'), 'Port Harcourt');
    await user.type(screen.getByLabelText('Address'), '9 Somewhere Close');
    // Ticked by default for a shopper with no addresses — untick it.
    await user.click(screen.getByLabelText(/save this address to my account/i));

    await walkToPlaced(user);

    expect(saveCheckoutAddressAction).not.toHaveBeenCalled();
  });
});
