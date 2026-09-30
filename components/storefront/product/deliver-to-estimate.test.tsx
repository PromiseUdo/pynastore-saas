// @vitest-environment jsdom
/*
 * "Deliver to … · Ships from …" on the product page (ROADMAP Phase 9.8).
 * The estimate itself is checkout's planner (tested against the database in
 * tests/settings-delivery.test.ts); this is what the shopper sees and when
 * the page asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorefrontProvider, type StorefrontShopper } from '@/lib/storefront/context';
import { useDeliverToStore } from '@/lib/storefront/stores/deliver-to-store';
import { formatMoney } from '@/lib/storefront/format';

const estimateDeliveryAction = vi.fn();
vi.mock('@/features/shop-orders/actions', () => ({
  estimateDeliveryAction: (input: unknown) => estimateDeliveryAction(input),
}));

const { DeliverToEstimate } = await import('./deliver-to-estimate');

const SHIPS = {
  ok: true as const,
  result: {
    ok: true as const,
    estimate: {
      storeName: 'Lagos Store',
      cheapest: { label: 'Interstate', price: 450_000, eta: { minMinutes: 2880, maxMinutes: 5760, unit: 'DAYS' as const } },
      moreOptions: true,
      pickupCount: 0,
    },
  },
};

const renderAs = (shopper: StorefrontShopper | null = null) =>
  render(
    <StorefrontProvider org={{ slug: 'demo', name: 'Demo Store', logoUrl: null }} isMobileRuntime={false} shopper={shopper}>
      <DeliverToEstimate productId="lamp" variantId="lamp" currency="NGN" summary={{ from: 250_000, free: false, nationwide: true }} />
    </StorefrontProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
  useDeliverToStore.setState({ place: null, hydrated: true });
  estimateDeliveryAction.mockReset();
});
afterEach(cleanup);

describe('DeliverToEstimate', () => {
  it('asks a guest where to deliver — one "from" line, no price table — and asks the server nothing until they say', async () => {
    renderAs();
    expect(screen.getByRole('heading', { name: /where should we deliver/i })).toBeDefined();
    expect(
      screen.getByText((_, element) => element?.tagName === 'SPAN' && /^Delivery across Nigeria, from ₦2,500\. Choose a location/.test(element.textContent ?? '')),
    ).toBeDefined();
    expect(estimateDeliveryAction).not.toHaveBeenCalled();
  });

  it('shows the store it ships from and its price once a place is chosen, remembering the place', async () => {
    estimateDeliveryAction.mockResolvedValue({ ...SHIPS, deliverTo: { state: 'Rivers', city: 'Port Harcourt', fromAccount: false } });
    const user = userEvent.setup();
    renderAs();

    await user.click(screen.getByRole('button', { name: /choose a location/i }));
    await user.selectOptions(screen.getByLabelText('State'), 'Rivers');
    await user.type(screen.getByLabelText('City or area'), 'Port Harcourt');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Ships from Lagos Store')).toBeDefined();
    expect(screen.getByText(formatMoney(450_000, 'NGN'))).toBeDefined();
    expect(screen.getByText(/confirmed at checkout/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: /deliver to port harcourt, rivers/i })).toBeDefined();
    expect(estimateDeliveryAction).toHaveBeenCalledWith({
      productId: 'lamp',
      variantId: 'lamp',
      deliverTo: { state: 'Rivers', city: 'Port Harcourt' },
    });
    expect(useDeliverToStore.getState().place).toEqual({ state: 'Rivers', city: 'Port Harcourt' });
  });

  it('estimates a signed-in shopper for their default address, and says that is what it is', async () => {
    estimateDeliveryAction.mockResolvedValue({ ...SHIPS, deliverTo: { state: 'Lagos', city: 'Ikeja', fromAccount: true } });
    renderAs({ id: 'c1', name: 'Ada Okoro', firstName: 'Ada', email: 'ada@example.com' });

    expect(await screen.findByText(/your default address/i)).toBeDefined();
    expect(estimateDeliveryAction).toHaveBeenCalledWith({ productId: 'lamp', variantId: 'lamp', deliverTo: null });
  });

  it('says plainly when the store doesn’t deliver there, or only offers collection', async () => {
    useDeliverToStore.setState({ place: { state: 'Kano', city: 'Kano' } });
    estimateDeliveryAction.mockResolvedValueOnce({
      ok: true,
      deliverTo: { state: 'Kano', city: 'Kano', fromAccount: false },
      result: { ok: false, reason: 'no-delivery', pickupCount: 0 },
    });
    renderAs();
    expect(await screen.findByText('This store doesn’t deliver to Kano, Kano yet.')).toBeDefined();
    cleanup();

    estimateDeliveryAction.mockResolvedValueOnce({
      ok: true,
      deliverTo: { state: 'Kano', city: 'Kano', fromAccount: false },
      result: { ok: false, reason: 'pickup-only', pickupCount: 1 },
    });
    renderAs();
    await waitFor(() => expect(screen.getByText(/but you can collect it/i)).toBeDefined());
  });
});
