// @vitest-environment jsdom
/*
 * The payment badges show only what this shop's checkout offers — and card
 * logos only alongside online payment, since no card is taken without it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PaymentMethodOption } from '@/lib/storefront/checkout/types';
import { PaymentBadges } from './payment-badges';

afterEach(cleanup);

const method = (id: string, label: string, provider: 'paystack' | 'manual', enabled = true): PaymentMethodOption => ({
  id,
  label,
  description: '',
  handoffNote: '',
  provider,
  settlesOnDelivery: id === 'pod',
  enabled,
});

const logos = () => screen.queryAllByRole('img').map((img) => img.getAttribute('alt'));

describe('PaymentBadges', () => {
  it('shows Paystack and the cards it takes, then the shop’s other ways to pay', () => {
    render(
      <PaymentBadges
        methods={[
          method('paystack', 'Pay online', 'paystack'),
          method('pod', 'Pay on delivery', 'manual'),
          method('transfer', 'Bank transfer', 'manual'),
          method('off', 'Switched off', 'manual', false),
        ]}
      />,
    );
    expect(logos()).toEqual(['Paystack', 'Visa', 'Mastercard', 'Verve']);
    const list = screen.getByRole('list', { name: 'Ways to pay' });
    expect(list.textContent).toContain('Pay online securely with Paystack');
    expect(list.textContent).toContain('Pay on delivery');
    expect(list.textContent).toContain('Bank transfer');
    expect(list.textContent).not.toContain('Switched off');
  });

  it('shows no Paystack or card logo when the shop can’t take online payments', () => {
    render(<PaymentBadges methods={[method('pod', 'Pay on delivery', 'manual')]} />);
    expect(logos()).toEqual([]);
    expect(screen.getByRole('list', { name: 'Ways to pay' }).textContent).toBe('Pay on delivery');
  });

  it('says nothing when checkout offers nothing', () => {
    const { container } = render(<PaymentBadges methods={[method('off', 'Off', 'manual', false)]} />);
    expect(container.innerHTML).toBe('');
  });
});
