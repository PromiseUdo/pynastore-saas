import { describe, it, expect } from 'vitest';
import { deliveryHeadline, paymentHeadline } from './store-claims';
import type { DeliveryPromise } from './types';
import type { PaymentMethodOption } from './checkout/types';

const option = (label: string, kind: 'delivery' | 'pickup' = 'delivery'): DeliveryPromise['options'][number] => ({
  id: label,
  label,
  detail: '',
  price: 250000,
  free: false,
  kind,
});

const method = (id: string, label: string, provider: 'squad' | 'manual', enabled = true): PaymentMethodOption => ({
  id,
  label,
  description: '',
  handoffNote: '',
  provider,
  enabled,
});

describe('deliveryHeadline', () => {
  it('says only what the delivery settings support', () => {
    expect(deliveryHeadline([option('Delivery across Nigeria'), option('Delivery to Lagos')])).toBe('Delivery across Nigeria');
    expect(deliveryHeadline([option('Delivery to Lagos')])).toBe('Delivery to selected areas');
    expect(deliveryHeadline([option('Delivery to Lagos'), option('Pick up: Ikeja', 'pickup')])).toBe(
      'Delivery to selected areas · Collect in store',
    );
    expect(deliveryHeadline([option('Pick up: Ikeja', 'pickup')])).toBe('Collect in store');
  });

  it('promises nothing — and never a delivery time — when there is nothing set up', () => {
    expect(deliveryHeadline([])).toBeNull();
    expect(deliveryHeadline([option('Delivery across Nigeria')])).not.toMatch(/day/);
  });
});

describe('paymentHeadline', () => {
  it('lists the enabled checkout methods, naming Squad for online payment', () => {
    expect(
      paymentHeadline([
        method('squad', 'Pay online', 'squad'),
        method('pod', 'Pay on delivery', 'manual'),
        method('transfer', 'Bank transfer', 'manual'),
        method('off', 'Switched off', 'manual', false),
      ]),
    ).toBe('Pay online securely with Squad · Pay on delivery · Bank transfer');
    expect(paymentHeadline([])).toBeNull();
  });

  it('never mentions Paystack', () => {
    expect(paymentHeadline([method('squad', 'Pay online', 'squad')])).not.toMatch(/paystack/i);
  });
});
