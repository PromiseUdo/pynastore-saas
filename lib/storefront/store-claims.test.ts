import { describe, it, expect } from 'vitest';
import { deliveryHeadline, deliverySummary } from './store-claims';
import type { DeliveryPromise } from './types';

const option = (
  label: string,
  kind: 'delivery' | 'pickup' = 'delivery',
  over: Partial<DeliveryPromise['options'][number]> = {},
): DeliveryPromise['options'][number] => ({
  id: label,
  label,
  detail: '',
  price: 250000,
  free: false,
  kind,
  nationwide: label.startsWith('Delivery across Nigeria'),
  ...over,
});

describe('deliverySummary', () => {
  it('is the cheapest delivery anywhere, and whether it reaches the whole country', () => {
    expect(
      deliverySummary([
        option('Delivery to Lagos from Port Harcourt store', 'delivery', { price: 450_000 }),
        option('Delivery across Nigeria from Lagos Store', 'delivery', { price: 500_000 }),
        option('Pick up: Ikeja', 'pickup', { price: 0, free: true }),
      ]),
    ).toEqual({ from: 450_000, free: false, nationwide: true });
  });

  it('is free when any delivery is, and null when the store only offers collection', () => {
    expect(deliverySummary([option('Delivery to Rivers', 'delivery', { price: 0, free: true })])).toMatchObject({ from: 0, free: true });
    expect(deliverySummary([option('Pick up: Ikeja', 'pickup')])).toBeNull();
  });
});

describe('deliveryHeadline', () => {
  it('knows nationwide delivery by the zone, even when several stores name themselves in the label', () => {
    expect(deliveryHeadline([option('Delivery across Nigeria from Lagos Store')])).toBe('Delivery across Nigeria');
  });

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
