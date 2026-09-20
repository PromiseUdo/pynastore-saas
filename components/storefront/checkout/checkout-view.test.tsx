// @vitest-environment jsdom
/*
 * The checkout, driven.
 *
 * lib/storefront/checkout/checkout.test.ts proves the rules; this proves
 * they reach the screen and survive a real person using them — that an
 * empty bag cannot start a checkout, that what you type in step 1 is still
 * there after a round trip to step 3, that a double-tap on Place Order makes
 * ONE order, that the bag empties only after that order exists, and that the
 * header badge notices.
 *
 * The form is exercised through the DOM (labels, roles, typed characters)
 * rather than by poking the store, because the thing under test is the
 * boundary between the two.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckoutView } from './checkout-view';
import { ConfirmationView, NoOrder } from './confirmation-view';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';
import { MiniCart } from '@/components/storefront/layout/mini-cart';
import { StorefrontProvider } from '@/lib/storefront/context';
import { useCartStore, useCartCount } from '@/lib/storefront/stores/cart-store';
import { useCheckoutStore } from '@/lib/storefront/stores/checkout-store';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { toCartLine } from '@/lib/storefront/cart';
import { formatMoney } from '@/lib/storefront/format';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { calculateCheckoutTotals } from '@/lib/storefront/checkout/totals';
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

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/checkout',
}));

/* The bag's catalogue check is the subject of its own tests; here it never
 * answers, so the lines render from their snapshot. */
vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

/* The order is written on the server now. Mocked here so the flow can be
 * driven without a database — what the server does with the payload is
 * proved in tests/storefront-orders.test.ts. */
const placeOrderAction = vi.fn(async (_request: unknown) => ({
  ok: true as const,
  reference: 'ORD-2026-000001',
  confirmationToken: 'token-abc',
  paymentUrl: null,
}) as unknown as {
  ok: boolean;
  reference?: string;
  confirmationToken?: string;
  paymentUrl?: string | null;
  message?: string;
});
const payForOrderAction = vi.fn(async (_token: string, _options?: unknown) => ({
  ok: true as const,
  paymentUrl: 'https://sandbox-pay.squadco.com/c_retry',
}));
vi.mock('@/features/shop-orders/actions', () => ({
  placeOrderAction: (request: unknown) => placeOrderAction(request as never),
  payForOrderAction: (token: string, options?: unknown) => payForOrderAction(token, options),
  payForMyOrderAction: vi.fn(),
  quoteDeliveryAction: (input: unknown) => quoteDeliveryAction(input),
  applyDiscountCodeAction: (input: unknown) => applyDiscountCodeAction(input),
}));

/* The merchant's codes live on the server; checkout only shows the field and
 * what the answer was worth. */
const applyDiscountCodeAction = vi.fn(async (input: unknown) => {
  const { code } = input as { code: string };
  return code === 'SAVE10'
    ? { ok: true as const, coupon: { code: 'SAVE10', label: '10% off', kind: 'percent' as const, value: 10, minSubtotal: null } }
    : { ok: false as const, message: 'That code isn’t valid.' };
});

/* A real store quotes delivery per address (the demo config has a fixed list
 * and never asks). Default: the merchant covers Rivers only. */
const quoteDeliveryAction = vi.fn(async (input: unknown) => {
  const { state } = input as { state: string };
  return state === 'Rivers'
    ? {
        ok: true as const,
        zoneName: 'Within Port Harcourt',
        options: [
          { id: 'rate_express', kind: 'delivery' as const, label: 'Same day', description: '', price: 400_000, regularPrice: 400_000, freeOver: null, etaDays: [0, 0] as [number, number] },
          { id: 'rate_local', kind: 'delivery' as const, label: 'Local', description: '', price: 150_000, regularPrice: 150_000, freeOver: null, etaDays: [1, 2] as [number, number] },
          {
            id: 'pickup_shop',
            kind: 'pickup' as const,
            label: 'Pick up: Main shop',
            description: '12 Aba Road, Port Harcourt, Rivers',
            price: 0,
            etaDays: [1, 1] as [number, number],
            pickup: { name: 'Main shop', address: '12 Aba Road', city: 'Port Harcourt', state: 'Rivers', instructions: null },
          },
        ],
      }
    : { ok: true as const, zoneName: null, options: [] };
});

/* Leaving for the payment provider is a full navigation, which jsdom can't
 * perform — record it instead. */
const locationReplace = vi.fn();
const locationAssign = vi.fn();
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...window.location, replace: locationReplace, assign: locationAssign },
});

const config = await getCheckoutConfig({ organizationSlug: 'demo' });

const MULTI = PRODUCTS.find((p) => p.options.length > 0 && p.variants.some((v) => v.stock > 2))!;
const SIMPLE = PRODUCTS.find((p) => p.options.length === 0 && p.variants[0]?.stock > 3)!;

const renderIn = (ui: React.ReactNode) =>
  render(
    <StorefrontProvider org={{ slug: 'demo', name: 'Demo Store', logoUrl: null }} isMobileRuntime={false}>
      {ui}
    </StorefrontProvider>,
  );

function addToBag(product: typeof SIMPLE, quantity = 1) {
  const variant = product.variants.find((v) => v.stock > 2) ?? product.variants[0];
  useCartStore.getState().addItem(toCartLine(product, variant.id)!, quantity);
}

beforeEach(() => {
  replace.mockClear();
  /* Stores re-read their tenant's storage whenever the active org changes
   * (lib/storefront/stores/storage.ts), so a test that switches store would
   * otherwise pick up orders an earlier test persisted. */
  window.localStorage.clear();
  window.sessionStorage.clear();
  useCartStore.setState({ items: [], savedForLater: [], coupon: null, hydrated: true });
  placeOrderAction.mockClear();
  payForOrderAction.mockClear();
  locationReplace.mockClear();
  locationAssign.mockClear();
  useCheckoutStore.getState().reset(config);
  useUIStore.setState({ overlay: null });
  window.scrollTo = vi.fn();
});

afterEach(cleanup);

/* ---------------- helpers that walk the flow ---------------- */

async function fillInformation(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('First name'), 'Ada');
  await user.type(screen.getByLabelText('Last name'), 'Okoro');
  await user.type(screen.getByLabelText('Email address'), 'ada@example.com');
  await user.type(screen.getByLabelText('Phone number'), '08012345678');
  await user.selectOptions(screen.getByLabelText('State'), 'Rivers');
  await user.type(screen.getByLabelText('City or town'), 'Port Harcourt');
  await user.type(screen.getByLabelText('Address'), '12 Example Street');
  await user.click(screen.getByRole('button', { name: /continue to delivery/i }));
  await screen.findByRole('heading', { name: 'Delivery' });
}

async function chooseDelivery(user: ReturnType<typeof userEvent.setup>, label = /standard delivery/i) {
  await user.click(screen.getByRole('radio', { name: label }));
  await user.click(screen.getByRole('button', { name: /continue to payment/i }));
  await screen.findByRole('heading', { name: 'Payment' });
}

async function choosePayment(user: ReturnType<typeof userEvent.setup>, label = /^pay online/i) {
  await user.click(screen.getByRole('radio', { name: label }));
  await user.click(screen.getByRole('button', { name: /review your order/i }));
  await screen.findByRole('heading', { name: 'Review your order' });
}

async function walkToReview(user: ReturnType<typeof userEvent.setup>, payment?: RegExp) {
  await fillInformation(user);
  await chooseDelivery(user);
  await choosePayment(user, payment);
}

/* ---------------- the gate ---------------- */

describe('getting into checkout', () => {
  it('cannot be used with an empty bag, and says so without scolding', () => {
    renderIn(<CheckoutView config={config} account={null} />);

    expect(screen.getByRole('heading', { name: /nothing to check out/i })).toBeDefined();
    expect(screen.queryByLabelText('Email address')).toBeNull();
    expect(screen.queryByRole('button', { name: /place order/i })).toBeNull();
    expect(screen.getByRole('link', { name: /view your bag/i })).toBeDefined();
  });

  it('loads the form when there is something to buy', () => {
    addToBag(SIMPLE, 2);
    renderIn(<CheckoutView config={config} account={null} />);

    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined();
    expect(screen.getByLabelText('Email address')).toBeDefined();
  });

  it('waits for the bag to rehydrate instead of flashing the empty state', () => {
    useCartStore.setState({ hydrated: false });
    renderIn(<CheckoutView config={config} account={null} />);
    expect(screen.queryByText(/nothing to check out/i)).toBeNull();
    expect(screen.queryByLabelText('Email address')).toBeNull();
  });
});

/* ---------------- the summary ---------------- */

describe('order summary', () => {
  it('shows each line with its variant, quantity and line total', () => {
    addToBag(MULTI, 2);
    renderIn(<CheckoutView config={config} account={null} />);

    const item = useCartStore.getState().items[0];
    /* Once per breakpoint panel — both read the same bag. */
    expect(screen.getAllByText(item.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(item.optionSummary).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(formatMoney(item.unitPrice * item.quantity, item.currency)).length,
    ).toBeGreaterThan(0);
  });

  it('prints the total the shared calculation produces, in the order’s currency', () => {
    addToBag(SIMPLE, 3);
    renderIn(<CheckoutView config={config} account={null} />);

    const items = useCartStore.getState().items;
    const totals = calculateCheckoutTotals({
      items,
      deliveryMethod: config.deliveryMethods.find((m) => m.id === config.defaultDeliveryMethodId),
      config,
    });
    expect(screen.getAllByText(formatMoney(totals.total, totals.currency)).length).toBeGreaterThan(0);
  });

  it('derives currency from the order rather than a hardcoded symbol', () => {
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={{ ...config, currency: 'GBP' }} account={null} />);
    /* The line's own snapshot currency wins — and it is formatted, not
     * concatenated with a literal. */
    const item = useCartStore.getState().items[0];
    expect(screen.getAllByText(formatMoney(item.unitPrice, item.currency)).length).toBeGreaterThan(0);
  });

  it('re-totals when a different delivery method is chosen', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    await fillInformation(user);
    await user.click(screen.getByRole('radio', { name: /express delivery/i }));

    const items = useCartStore.getState().items;
    const express = calculateCheckoutTotals({
      items,
      deliveryMethod: config.deliveryMethods.find((m) => m.id === 'express'),
      config,
    });
    await waitFor(() =>
      expect(screen.getAllByText(formatMoney(express.total, express.currency)).length).toBeGreaterThan(0),
    );
  });

  /* A shopper who taps Checkout in the mini-cart never passes /cart, so the
   * code box has to be here too — it went missing once. */
  it('offers the discount code field, and takes the saving off the total', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 2);
    renderIn(<CheckoutView config={config} account={null} />);

    const fields = screen.getAllByLabelText('Discount code');
    expect(fields.length).toBeGreaterThan(0);

    await user.type(fields[0], 'save10');
    await user.click(screen.getAllByRole('button', { name: 'Apply' })[0]);

    await waitFor(() => expect(screen.getAllByText('SAVE10').length).toBeGreaterThan(0));
    expect(applyDiscountCodeAction).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SAVE10' }),
    );

    const items = useCartStore.getState().items;
    const discounted = calculateCheckoutTotals({
      items,
      deliveryMethod: config.deliveryMethods.find((m) => m.id === config.defaultDeliveryMethodId),
      discount: useCartStore.getState().coupon,
      config,
    });
    expect(discounted.discount).toBe(Math.round(discounted.subtotal / 10));
    expect(screen.getAllByText(formatMoney(discounted.total, discounted.currency)).length).toBeGreaterThan(0);
  });

  it('says so when a code is refused, and leaves the total alone', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    await user.type(screen.getAllByLabelText('Discount code')[0], 'NOPE');
    await user.click(screen.getAllByRole('button', { name: 'Apply' })[0]);

    await waitFor(() => expect(screen.getAllByText('That code isn’t valid.').length).toBeGreaterThan(0));
    expect(useCartStore.getState().coupon).toBeNull();
  });
});

/* ---------------- validation ---------------- */

describe('validation', () => {
  it('will not advance an empty information step, and explains each field', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    await user.click(screen.getByRole('button', { name: /continue to delivery/i }));

    expect(await screen.findByText('Enter your first name.')).toBeDefined();
    expect(screen.getByText('Enter your last name.')).toBeDefined();
    expect(screen.getByText('Enter your email address.')).toBeDefined();
    expect(screen.getByText('Enter your phone number.')).toBeDefined();
    expect(screen.getByText('Enter your delivery address.')).toBeDefined();
    /* Still on step 1. */
    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined();
  });

  it('never falls back to a generic "form is invalid"', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    await user.click(screen.getByRole('button', { name: /continue to delivery/i }));
    await screen.findByText('Enter your first name.');
    expect(screen.queryByText(/form is invalid/i)).toBeNull();
  });

  it('names the problem with a malformed email, beside the email field', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    const email = screen.getByLabelText('Email address');
    await user.type(email, 'ada@example');
    await user.click(screen.getByRole('button', { name: /continue to delivery/i }));

    const message = await screen.findByText('Enter a valid email address.');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain(message.id);
  });

  it('asks for a postal code only where the country needs one', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    /* Nigeria: optional, and the label says so. */
    expect(screen.getByLabelText(/postal code/i)).toBeDefined();
    await fillInformation(user);
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
  });

  it('relabels the address form for the chosen country', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    /* Stores deliver in Nigeria only for now; the form still adapts to a
     * country whose words and rules differ. */
    const withUK = {
      ...config,
      countries: [
        ...config.countries,
        { code: 'GB', name: 'United Kingdom', regionLabel: 'County', regions: [], postalCodeLabel: 'Postcode', postalCodeRequired: true, phonePrefix: '+44' },
      ],
    };
    renderIn(<CheckoutView config={withUK} account={null} />);

    await user.selectOptions(screen.getByLabelText('Country'), 'GB');
    expect(await screen.findByLabelText('County')).toBeDefined();
    expect(screen.getByLabelText(/postcode/i)).toBeDefined();
  });

  it('will not advance past delivery or payment without a choice', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    /* A store with nothing preselected, so the shopper must choose. The
     * draft is reset against THIS config too — otherwise the default method
     * the full config seeded in beforeEach would still be sitting there. */
    const blank = { ...config, defaultDeliveryMethodId: '' };
    useCheckoutStore.getState().reset(blank);
    renderIn(<CheckoutView config={blank} account={null} />);

    await fillInformation(user);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));
    expect(await screen.findByText('Choose how you’d like your order delivered.')).toBeDefined();

    await user.click(screen.getByRole('radio', { name: /standard delivery/i }));
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));
    await screen.findByRole('heading', { name: 'Payment' });

    await user.click(screen.getByRole('button', { name: /review your order/i }));
    expect(await screen.findByText('Choose how you’d like to pay.')).toBeDefined();
  });
});

/* ---------------- selection ---------------- */

describe('delivery and payment selection', () => {
  it('offers each delivery option with its window and price, and allows only one', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await fillInformation(user);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(config.deliveryMethods.length);
    /* Once on the card, once as the summary's delivery hint — both read the
     * same method. */
    expect(screen.getAllByText('2–4 working days').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(formatMoney(config.deliveryMethods[1].price, config.currency)).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('radio', { name: /express delivery/i }));
    expect(screen.getByRole('radio', { name: /express delivery/i }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /standard delivery/i }).getAttribute('aria-checked')).toBe('false');
  });

  it('shows free pickup as free rather than as a zero amount', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await fillInformation(user);
    expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
  });

  it('collects no card details, and says card payment happens on Squad', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await fillInformation(user);
    await chooseDelivery(user);

    await user.click(screen.getByRole('radio', { name: /^pay online/i }));

    expect(await screen.findByText(/squad’s secure payment page/i)).toBeDefined();
    /* Nothing anywhere that could take a card number. */
    expect(screen.queryByLabelText(/card number/i)).toBeNull();
    expect(screen.queryByLabelText(/cvv|security code|expiry/i)).toBeNull();
  });
});

/* ---------------- moving around ---------------- */

describe('checkout navigation', () => {
  it('keeps everything entered when moving back and forth', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    await fillInformation(user);
    await chooseDelivery(user, /express delivery/i);

    /* Back to the start... */
    await user.click(screen.getByRole('button', { name: /back to delivery/i }));
    await screen.findByRole('heading', { name: 'Delivery' });
    await user.click(screen.getByRole('button', { name: /back to your details/i }));

    const email = await screen.findByLabelText('Email address');
    expect((email as HTMLInputElement).value).toBe('ada@example.com');
    expect((screen.getByLabelText('City or town') as HTMLInputElement).value).toBe('Port Harcourt');
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('12 Example Street');

    /* ...and forward again, with the delivery choice intact. */
    await user.click(screen.getByRole('button', { name: /continue to delivery/i }));
    await screen.findByRole('heading', { name: 'Delivery' });
    expect(screen.getByRole('radio', { name: /express delivery/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('lets a completed step be reached from the progress indicator', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    await fillInformation(user);
    await user.click(screen.getByRole('button', { name: /information/i }));
    expect(await screen.findByRole('heading', { name: /your details/i })).toBeDefined();
  });

  it('marks the current step for a screen reader, not only visually', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await fillInformation(user);

    const progress = screen.getByRole('navigation', { name: /checkout progress/i });
    expect(within(progress).getByText(/current step/i)).toBeDefined();
    expect(within(progress).getAllByText(/completed/i).length).toBeGreaterThan(0);
  });
});

/* ---------------- review ---------------- */

describe('order review', () => {
  it('reflects everything that was entered', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 2);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    /* The name appears as the contact AND as the first line of the address
     * — that is what the courier gets, and the review shows both. */
    expect(screen.getAllByText('Ada Okoro').length).toBe(2);
    expect(screen.getByText('ada@example.com')).toBeDefined();
    expect(screen.getByText('12 Example Street')).toBeDefined();
    expect(screen.getByText('Port Harcourt, Rivers')).toBeDefined();
    expect(screen.getByText('Nigeria')).toBeDefined();
    expect(screen.getAllByText(/standard delivery/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pay online').length).toBeGreaterThan(0);
  });

  it('lets each block be corrected from where the mistake is shown', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    await user.click(screen.getByRole('button', { name: /edit delivery method/i }));
    expect(await screen.findByRole('heading', { name: 'Delivery' })).toBeDefined();
  });

  it('states the total being committed to, beside the button', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 2);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    const totals = calculateCheckoutTotals({
      items: useCartStore.getState().items,
      deliveryMethod: config.deliveryMethods.find((m) => m.id === 'standard'),
      config,
    });
    expect(screen.getByText(/you’re placing an order for/i)).toBeDefined();
    expect(screen.getAllByText(formatMoney(totals.total, totals.currency)).length).toBeGreaterThan(0);
  });
});

/* ---------------- placing the order ---------------- */

describe('delivery quoted for the address', () => {
  const quotedConfig = { ...config, deliveryMethods: [], defaultDeliveryMethodId: '', deliveryAvailable: true };

  it('shows the merchant’s options for the address and preselects the first quoted', async () => {
    quoteDeliveryAction.mockClear();
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    useCheckoutStore.getState().reset(quotedConfig);
    renderIn(<CheckoutView config={quotedConfig} account={null} />);
    await fillInformation(user);

    expect(await screen.findByRole('radio', { name: /^local/i })).toBeDefined();
    expect(quoteDeliveryAction).toHaveBeenCalledWith(expect.objectContaining({ state: 'Rivers', city: 'Port Harcourt' }));
    expect(screen.getByText(/options for/i).textContent).toContain('Port Harcourt, Rivers');
    expect(screen.getByRole('radio', { name: /pick up: main shop/i })).toBeDefined();
    expect(screen.getByRole('radio', { name: /^same day/i }).getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('radio', { name: /^local/i }));
    expect(screen.getAllByText(formatMoney(150_000, 'NGN')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));
    expect(await screen.findByRole('heading', { name: 'Payment' })).toBeDefined();
  });

  it('says so plainly when the store doesn’t deliver to the address', async () => {
    quoteDeliveryAction.mockImplementationOnce(async () => ({ ok: true as const, zoneName: null, options: [] }));
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    useCheckoutStore.getState().reset(quotedConfig);
    renderIn(<CheckoutView config={quotedConfig} account={null} />);
    await fillInformation(user);

    expect(await screen.findByText(/doesn’t deliver to port harcourt, rivers yet/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /change address/i }));
    expect(await screen.findByRole('heading', { name: 'Your details' })).toBeDefined();
  });

  it('won’t open checkout at all for a store with no delivery set up', () => {
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={{ ...quotedConfig, deliveryAvailable: false }} account={null} />);
    expect(screen.getByText(/checkout isn’t open yet/i)).toBeDefined();
    expect(screen.queryByLabelText('First name')).toBeNull();
  });
});

describe('placing the order', () => {
  it('places exactly one order and goes to the confirmation with its token', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 2);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(placeOrderAction).toHaveBeenCalledTimes(1));

    const sent = placeOrderAction.mock.calls[0][0] as unknown as {
      lines: { quantity: number }[];
      contact: { email: string };
    };
    expect(sent.lines).toHaveLength(1);
    expect(sent.lines[0].quantity).toBe(2);
    expect(sent.contact.email).toBe('ada@example.com');

    /* The token, never the sequential reference — see the note in the
     * checkout view. */
    expect(replace).toHaveBeenCalledWith('/checkout/confirmation?t=token-abc');
    expect(locationReplace).not.toHaveBeenCalled();
  });

  it('sends the shopper to the payment page once the order exists', async () => {
    placeOrderAction.mockImplementationOnce(async () => ({
      ok: true,
      reference: 'ORD-2026-000001',
      confirmationToken: 'token-abc',
      paymentUrl: 'https://sandbox-pay.squadco.com/c_abc',
    }));
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith('https://sandbox-pay.squadco.com/c_abc'));
    expect(replace).not.toHaveBeenCalled();
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(await screen.findByText(/secure payment page/i)).toBeDefined();
  });

  it('goes straight to the confirmation for pay on delivery', async () => {
    placeOrderAction.mockImplementationOnce(async (request: unknown) => ({
      ok: true,
      reference: 'ORD-2026-000002',
      confirmationToken: 'token-pod',
      paymentUrl: null,
      confirmationPath: '/checkout/confirmation?t=token-pod',
      echo: request,
    }));
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user, /^pay on delivery/i);

    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/checkout/confirmation?t=token-pod'));
    expect(locationReplace).not.toHaveBeenCalled();
    const sent = placeOrderAction.mock.calls[0][0] as unknown as { paymentMethodId: string; nativeApp: boolean };
    expect(sent.paymentMethodId).toBe('pod');
    expect(sent.nativeApp).toBe(false);
  });

  it('makes ONE order out of a double-tap', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    const button = screen.getByRole('button', { name: /place order/i });
    await Promise.all([user.click(button), user.click(button), user.click(button)]);

    await waitFor(() => expect(placeOrderAction).toHaveBeenCalledTimes(1));
    expect(placeOrderAction).toHaveBeenCalledTimes(1);
  });

  it('refuses a second submission once one has succeeded', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);
    await user.click(screen.getByRole('button', { name: /place order/i }));
    await waitFor(() => expect(useCheckoutStore.getState().status).toBe('placed'));

    const again = await useCheckoutStore.getState().placeOrder({ config, tenantId: 'demo' });
    expect(again.ok).toBe(true);
    /* Answered from what the first submission returned — the server is not
     * asked a second time, because that would be a second order. */
    expect(placeOrderAction).toHaveBeenCalledTimes(1);
  });

  it('empties the bag — but only after the order exists', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 2);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    expect(useCartStore.getState().items).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(0));
    /* The bag went only after the server had the order. */
    expect(placeOrderAction).toHaveBeenCalledTimes(1);
  });

  it('leaves the bag alone when checkout is rejected', async () => {
    addToBag(SIMPLE, 1);
    /* A store offering no payment method at all: nothing can be chosen, so
     * the service must refuse — and must not take the bag with it. */
    const result = await useCheckoutStore.getState().placeOrder({
      config: { ...config, paymentMethods: [] },
      tenantId: 'demo',
    });

    expect(result.ok).toBe(false);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(placeOrderAction).not.toHaveBeenCalled();
    expect(useCheckoutStore.getState().status).toBe('failed');
  });

  it('updates the header badge, because there is one bag', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 3);

    function Badge() {
      return <span data-testid="badge">{useCartCount()}</span>;
    }
    renderIn(
      <>
        <Badge />
        <CheckoutView config={config} account={null} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('badge').textContent).toBe('3'));

    await walkToReview(user);
    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(screen.getByTestId('badge').textContent).toBe('0'));
  });

  it('empties the mini-cart too', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(
      <>
        <MiniCart />
        <CheckoutView config={config} account={null} />
      </>,
    );

    /* The drawer stays shut while the form is driven: an open Radix sheet is
     * a modal and puts `pointer-events: none` on everything behind it, which
     * is correct behaviour and would make typing into the form impossible. */
    await walkToReview(user);
    await user.click(screen.getByRole('button', { name: /place order/i }));
    await waitFor(() => expect(useCartStore.getState().isEmpty()).toBe(true));

    /* Opened after the fact, it reads the same cleared bag. */
    useUIStore.setState({ overlay: 'cart' });
    expect(await screen.findByText(/your bag is empty/i)).toBeDefined();
  });

  it('cannot be submitted while invalid, and sends the shopper to the step that needs fixing', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);

    /* Jump to review with nothing filled in, the way a stale step could. */
    useCheckoutStore.getState().setStep('review');
    await screen.findByRole('heading', { name: /review your order/i });

    await user.click(screen.getByRole('button', { name: /place order/i }));

    expect(await screen.findByRole('heading', { name: /your details/i })).toBeDefined();
    expect(placeOrderAction).not.toHaveBeenCalled();
  });
});

/* ---------------- confirmation ---------------- */

describe('confirmation', () => {
  /* The confirmation is a server-rendered read of a real order now, so it is
   * given one rather than fishing one out of a browser store. What a placed
   * order actually contains is proved in tests/storefront-orders.test.ts. */
  const order: StorefrontOrder = {
    reference: 'ORD-2026-000001',
    status: 'PENDING',
    paymentStatus: 'AWAITING_PAYMENT',
    paymentMethodId: 'squad',
    transferDetails: null,
    placedAt: '2026-09-16T10:00:00.000Z',
    stageDates: { confirmedAt: null, packingAt: null, shippedAt: null, deliveredAt: null },
    contact: { firstName: 'Ada', lastName: 'Okoro', email: 'ada@example.com', phone: '08012345678' },
    shippingAddress: {
      fullName: 'Ada Okoro',
      phone: '08012345678',
      line1: '12 Example Street',
      line2: null,
      city: 'Port Harcourt',
      state: 'Rivers',
      country: 'Nigeria',
      postalCode: null,
    },
    delivery: {
      methodId: 'standard',
      label: 'Standard delivery',
      fee: 250_000,
      etaDays: [2, 4],
      estimated: { from: '2026-09-18T10:00:00.000Z', to: '2026-09-22T10:00:00.000Z' },
    },
    currency: 'NGN',
    totals: { subtotal: 1_000_000, discount: 0, shipping: 250_000, tax: 0, total: 1_250_000 },
    discountCode: null,
    note: null,
    lines: [
      {
        id: 'line_1',
        productId: 'p1',
        variantId: 'v1',
        name: 'Canvas Tote',
        variantName: null,
        sku: null,
        imageUrl: null,
        slug: 'canvas-tote',
        quantity: 2,
        unitPrice: 500_000,
        totalPrice: 1_000_000,
      },
    ],
    itemCount: 2,
    cancellation: null,
    refunds: { total: 0, owed: 0, lastAt: null },
    returns: [],
    selfService: { canCancel: true, returns: { open: false, reason: 'not-delivered', deadline: null } },
  };

  const paths = { confirmationToken: 'token-abc', confirmationPath: '/checkout/confirmation?t=token-abc' };
  const unpaid = { canPay: true, lastAttemptFailed: false, cancelReason: null, ...paths };
  const settled = { canPay: false, lastAttemptFailed: false, cancelReason: null, ...paths };
  const paidOrder: StorefrontOrder = { ...order, status: 'CONFIRMED', paymentStatus: 'PAID' };

  it('shows the order reference, the email and the totals', () => {
    renderIn(<ConfirmationView order={paidOrder} config={config} signedIn={false} payment={settled} />);

    expect(screen.getByRole('heading', { name: /order confirmed/i })).toBeDefined();
    expect(screen.getByText(order.reference)).toBeDefined();
    expect(screen.getByText('ada@example.com')).toBeDefined();
    expect(screen.getByText('2 items · placed', { exact: false })).toBeDefined();
    expect(screen.getAllByText(formatMoney(order.totals.total, order.currency)).length).toBeGreaterThan(0);
  });

  it('never calls an unpaid order confirmed, and offers to pay', () => {
    renderIn(<ConfirmationView order={order} config={config} signedIn={false} payment={unpaid} />);
    expect(screen.getByRole('heading', { name: /waiting for payment/i })).toBeDefined();
    expect(screen.queryByRole('heading', { name: /order confirmed/i })).toBeNull();
    expect(screen.getByText(/awaiting payment/i)).toBeDefined();
    expect(screen.queryByText(/payment received|paid in full|payment successful/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: `Pay ${formatMoney(order.totals.total, order.currency)}` }),
    ).toBeDefined();
  });

  it('opens a fresh payment from "Pay now"', async () => {
    const user = userEvent.setup();
    renderIn(<ConfirmationView order={order} config={config} signedIn={false} payment={unpaid} />);
    await user.click(screen.getByRole('button', { name: /^pay /i }));
    await waitFor(() => expect(payForOrderAction).toHaveBeenCalledWith('token-abc', { nativeApp: false }));
    expect(locationAssign).toHaveBeenCalledWith('https://sandbox-pay.squadco.com/c_retry');
  });

  it('says a declined or abandoned payment didn’t go through', () => {
    renderIn(
      <ConfirmationView
        order={order}
        config={config}
        signedIn={false}
        payment={{ ...unpaid, lastAttemptFailed: true }}
      />,
    );
    expect(screen.getByText(/payment didn’t go through/i)).toBeDefined();
  });

  it('says plainly when an unpaid order timed out, and offers nothing to pay', () => {
    const cancelledOrder: StorefrontOrder = { ...order, status: 'CANCELLED' };
    renderIn(
      <ConfirmationView
        order={cancelledOrder}
        config={config}
        signedIn={false}
        payment={{ ...settled, cancelReason: 'payment-timeout' }}
      />,
    );
    expect(screen.getByRole('heading', { name: /this order was cancelled/i })).toBeDefined();
    expect(screen.getByText(/didn’t receive your payment in time/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /^pay /i })).toBeNull();
    expect(screen.queryByText(/awaiting payment/i)).toBeNull();
  });

  it('confirms a pay-on-delivery order without asking for money now', () => {
    const podOrder: StorefrontOrder = { ...order, paymentMethodId: 'pod', paymentStatus: 'DUE_ON_DELIVERY' };
    renderIn(<ConfirmationView order={podOrder} config={config} signedIn={false} payment={settled} />);
    expect(screen.getByRole('heading', { name: /order received/i })).toBeDefined();
    expect(screen.getByText('Pay on delivery')).toBeDefined();
    expect(screen.queryByRole('button', { name: /^pay /i })).toBeNull();
  });

  it('shows where to send a bank transfer, and waits for it', () => {
    const transferOrder: StorefrontOrder = {
      ...order,
      paymentMethodId: 'transfer',
      paymentStatus: 'AWAITING_TRANSFER',
      transferDetails: [{ bankName: 'GTBank', accountName: 'Pynacode Ltd', accountNumber: '0123456789' }],
    };
    renderIn(<ConfirmationView order={transferOrder} config={config} signedIn={false} payment={settled} />);
    expect(screen.getByRole('heading', { name: /waiting for your transfer/i })).toBeDefined();
    expect(screen.getByText('0123456789')).toBeDefined();
    expect(screen.getByText('Pynacode Ltd')).toBeDefined();
    expect(screen.getAllByText(order.reference).length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: /copy account number/i })).toBeDefined();
    expect(screen.queryByRole('heading', { name: /order confirmed/i })).toBeNull();
  });

  it('offers nothing to pay once the order is paid', () => {
    renderIn(<ConfirmationView order={paidOrder} config={config} signedIn={false} payment={settled} />);
    expect(screen.queryByRole('button', { name: /^pay /i })).toBeNull();
    expect(screen.getByText('Paid')).toBeDefined();
  });

  it('offers a guest an account, and does not nag someone who has one', () => {
    renderIn(<ConfirmationView order={paidOrder} config={config} signedIn={false} payment={settled} />);
    expect(screen.getByRole('link', { name: /create an account/i })).toBeDefined();

    cleanup();
    renderIn(<ConfirmationView order={paidOrder} config={config} signedIn payment={settled} />);
    expect(screen.queryByRole('link', { name: /create an account/i })).toBeNull();
    expect(screen.getByRole('link', { name: /view this order/i })).toBeDefined();
  });

  it('says so plainly when the link opens no order', () => {
    renderIn(<NoOrder />);
    expect(screen.getByRole('heading', { name: /no order to show/i })).toBeDefined();
    expect(screen.queryByText(/order confirmed/i)).toBeNull();
  });
});

/* ---------------- no distractions ---------------- */

describe('focus', () => {
  it('shows no recommendations, trending rails or promotions', async () => {
    const user = userEvent.setup();
    addToBag(SIMPLE, 1);
    renderIn(<CheckoutView config={config} account={null} />);
    await walkToReview(user);

    for (const noise of [/you might also like/i, /trending/i, /recently viewed/i, /complete the look/i, /newsletter/i]) {
      expect(screen.queryByText(noise)).toBeNull();
    }
  });
});
