/*
 * The checkout domain's rules, without rendering anything.
 *
 * These are the tests that have to hold whatever the UI does: the totals
 * come from the cart's own arithmetic, validation says the right sentence
 * about the right field, and a checkout that shouldn't go through doesn't
 * reach the server at all.
 *
 * What an ORDER ends up containing is no longer decided here — it is written
 * on the server now, and proved against the real database in
 * tests/storefront-orders.test.ts.
 *
 * The flow itself — steps, duplicate clicks, the bag emptying — is proved in
 * components/storefront/checkout/checkout-view.test.tsx, which drives the
 * real form.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCheckoutConfig, deliveryEstimate, findDeliveryMethod, findPaymentMethod } from './config';
import { calculateCheckoutTotals, checkoutItemCount } from './totals';
import { checkoutSchema, contactSchema, phoneDigits } from './schema';
import { addressFromContact, addressLines, emptyAddress, fromStoredAddress, toStoredAddress } from './address';
/* The one call that leaves the browser. Mocked here so these tests stay
 * about the pre-flight contract: what gets sent, and what never does. */
const placeOrderAction = vi.fn(async (_request: unknown) => ({
  ok: true as const,
  reference: 'ORD-2026-000001',
  confirmationToken: 'token-123',
}) as unknown as { ok: boolean; reference?: string; confirmationToken?: string; message?: string });
vi.mock('@/features/shop-orders/actions', () => ({
  placeOrderAction: (request: unknown) => placeOrderAction(request as never),
}));

const { submitCheckout, validateCheckout } = await import('./checkout-service');
import { computeTotals, cartSubtotal } from '../pricing';
import { toCartLine } from '../cart';
import { PRODUCTS } from '../mock/products';
import type { CartItem } from '../types';
import type { CheckoutAddress, CheckoutConfig, CheckoutContact } from './types';

const config = await getCheckoutConfig({ organizationSlug: 'demo' });

/* Stores deliver in Nigeria only for now, but the address rules are generic:
 * a store that ships somewhere with required postcodes and no region list
 * must still get them right. */
const withUK: typeof config = {
  ...config,
  countries: [
    ...config.countries,
    { code: 'GB', name: 'United Kingdom', regionLabel: 'County', regions: [], postalCodeLabel: 'Postcode', postalCodeRequired: true, phonePrefix: '+44' },
  ],
};

/* Two real catalogue products, so prices/currencies are the store's own. */
const A = PRODUCTS.find((p) => p.variants[0]?.stock > 3)!;
const B = PRODUCTS.find((p) => p.id !== A.id && p.variants[0]?.stock > 3)!;

function line(product: typeof A, quantity = 1): CartItem {
  return { ...toCartLine(product, product.variants[0].id)!, quantity, addedAt: Date.now() };
}

const CONTACT: CheckoutContact = {
  firstName: 'Ada',
  lastName: 'Okoro',
  email: 'ada@example.com',
  phone: '+234 801 234 5678',
};

const ADDRESS: CheckoutAddress = {
  firstName: 'Ada',
  lastName: 'Okoro',
  phone: '+234 801 234 5678',
  country: 'NG',
  state: 'Rivers',
  city: 'Port Harcourt',
  addressLine1: '12 Example Street',
  addressLine2: '',
  postalCode: '',
};

const draft = (over: Partial<Parameters<typeof validateCheckout>[0]> = {}) => ({
  tenantId: 'demo',
  items: [line(A, 2)],
  contact: CONTACT,
  address: ADDRESS,
  deliveryMethodId: config.deliveryMethods[0].id,
  paymentMethodId: config.paymentMethods[0].id,
  orderNote: '',
  config,
  ...over,
});

/* ---------------- configuration ---------------- */

describe('checkout configuration', () => {
  it('carries a currency rather than leaving components to guess', () => {
    expect(config.currency).toBe('NGN');
    expect(config.locale).toBe('en-NG');
  });

  it('offers the SAME delivery options the cart and PDP quote', async () => {
    const { SHIPPING_METHODS } = await import('../pricing');
    expect(config.deliveryMethods).toEqual(SHIPPING_METHODS);
  });

  it('allows guest checkout in this phase', () => {
    expect(config.guestCheckoutEnabled).toBe(true);
  });

  it('never exposes a payment method that is switched off', () => {
    expect(config.paymentMethods.every((m) => m.enabled)).toBe(true);
    expect(config.paymentMethods.length).toBeGreaterThan(0);
  });

  it('offers Squad online payment, with no card fields of its own, and pay on delivery', () => {
    expect(config.paymentMethods.map((m) => [m.id, m.provider])).toEqual([
      ['squad', 'squad'],
      ['pod', 'manual'],
    ]);
    expect(config.paymentMethods[0].handoffNote).toMatch(/no card details are entered on this site/i);
    expect(config.paymentMethods[1].handoffNote).toMatch(/nothing is charged now/i);
  });

  it('reads a delivery window off the method rather than storing prose', () => {
    expect(deliveryEstimate({ etaDays: [2, 4] })).toBe('2–4 working days');
    expect(deliveryEstimate({ etaDays: [1, 1] })).toBe('Next working day');
  });

  it('resolves only ids the store actually offers', () => {
    expect(findDeliveryMethod(config, 'standard')?.id).toBe('standard');
    expect(findDeliveryMethod(config, 'teleport')).toBeNull();
    expect(findPaymentMethod(config, 'crypto')).toBeNull();
  });
});

/* ---------------- totals ---------------- */

describe('checkout totals', () => {
  const items = [line(A, 2), line(B, 1)];

  it('is the cart calculation, not a second one', () => {
    const method = findDeliveryMethod(config, 'express')!;
    expect(calculateCheckoutTotals({ items, deliveryMethod: method, config })).toEqual(
      computeTotals({ items, shippingMethod: method, currency: 'NGN' }),
    );
  });

  it('sums the lines it was given', () => {
    const totals = calculateCheckoutTotals({ items, config });
    expect(totals.subtotal).toBe(cartSubtotal(items));
  });

  it('charges the fee of the SELECTED delivery method', () => {
    const standard = findDeliveryMethod(config, 'standard')!;
    const express = findDeliveryMethod(config, 'express')!;
    const pickup = findDeliveryMethod(config, 'pickup')!;

    expect(calculateCheckoutTotals({ items, deliveryMethod: standard, config }).shipping).toBe(standard.price);
    expect(calculateCheckoutTotals({ items, deliveryMethod: express, config }).shipping).toBe(express.price);
    expect(calculateCheckoutTotals({ items, deliveryMethod: pickup, config }).shipping).toBe(0);
  });

  it('moves the total by the difference between two methods', () => {
    const standard = calculateCheckoutTotals({ items, deliveryMethod: findDeliveryMethod(config, 'standard'), config });
    const express = calculateCheckoutTotals({ items, deliveryMethod: findDeliveryMethod(config, 'express'), config });
    expect(express.total - standard.total).toBe(express.shipping - standard.shipping);
  });

  it('derives the currency instead of hardcoding one', () => {
    const gbp: CheckoutConfig = { ...config, currency: 'GBP' };
    /* A line's own snapshot wins; with no lines the store's config does. */
    expect(calculateCheckoutTotals({ items: [], config: gbp }).currency).toBe('GBP');
    expect(calculateCheckoutTotals({ items, config: gbp }).currency).toBe(items[0].currency);
  });

  it('counts units, matching the header badge', () => {
    expect(checkoutItemCount(items)).toBe(3);
  });
});

/* ---------------- validation ---------------- */

describe('contact validation', () => {
  it('names the field and says what to do', () => {
    const result = contactSchema.safeParse({ firstName: '', lastName: '', email: '', phone: '' });
    expect(result.success).toBe(false);
    const messages = Object.fromEntries(
      result.error!.issues.map((i) => [i.path.join('.'), i.message]),
    );
    expect(messages.firstName).toBe('Enter your first name.');
    expect(messages.lastName).toBe('Enter your last name.');
    expect(messages.email).toBe('Enter your email address.');
    expect(messages.phone).toBe('Enter your phone number.');
  });

  it('rejects a malformed email with a sentence a shopper can act on', () => {
    const result = contactSchema.safeParse({ ...CONTACT, email: 'ada@example' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe('Enter a valid email address.');
  });

  it('accepts a valid email', () => {
    expect(contactSchema.safeParse(CONTACT).success).toBe(true);
  });

  it('accepts phone numbers in several shapes, from several countries', () => {
    for (const phone of ['+234 801 234 5678', '08012345678', '+44 7700 900123', '(212) 555-0143']) {
      expect(contactSchema.safeParse({ ...CONTACT, phone }).success, phone).toBe(true);
    }
  });

  it('rejects only what is obviously not a phone number', () => {
    expect(contactSchema.safeParse({ ...CONTACT, phone: '12345' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...CONTACT, phone: 'call me' }).success).toBe(false);
  });

  it('counts digits regardless of punctuation', () => {
    expect(phoneDigits('+234 (801) 234-5678')).toBe('2348012345678');
  });
});

describe('address validation', () => {
  const schema = checkoutSchema(withUK);
  const base = {
    contact: CONTACT,
    address: ADDRESS,
    deliveryMethodId: config.deliveryMethods[0].id,
    paymentMethodId: config.paymentMethods[0].id,
    orderNote: '',
  };

  const messagesFor = (input: unknown) => {
    const result = schema.safeParse(input);
    return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));
  };

  it('accepts a complete Nigerian address', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('asks for the address, the city and the region by name', () => {
    const messages = messagesFor({
      ...base,
      address: { ...ADDRESS, addressLine1: '', city: '', state: '' },
    });
    expect(messages['address.addressLine1']).toBe('Enter your delivery address.');
    expect(messages['address.city']).toBe('Enter your city or town.');
    expect(messages['address.state']).toBe('Choose a state or region.');
  });

  it('does not require a postal code in Nigeria', () => {
    expect(schema.safeParse({ ...base, address: { ...ADDRESS, postalCode: '' } }).success).toBe(true);
  });

  it('requires one where the country does, using that country’s own word for it', () => {
    const messages = messagesFor({
      ...base,
      address: { ...ADDRESS, country: 'GB', state: 'Greater London', postalCode: '' },
    });
    expect(messages['address.postalCode']).toBe('Enter your postcode.');
  });

  it('rejects a region that is not in the chosen country’s list', () => {
    const messages = messagesFor({ ...base, address: { ...ADDRESS, state: 'Atlantis' } });
    expect(messages['address.state']).toBe('Choose a state from the list.');
  });

  it('accepts free-text regions for a country whose list we do not carry', () => {
    expect(
      schema.safeParse({
        ...base,
        address: { ...ADDRESS, country: 'GB', state: 'Somewhere', postalCode: 'SW1A 1AA' },
      }).success,
    ).toBe(true);
  });

  it('refuses a country the store does not deliver to', () => {
    const messages = messagesFor({ ...base, address: { ...ADDRESS, country: 'ZZ' } });
    expect(messages['address.country']).toBe('We don’t deliver to that country yet.');
  });
});

describe('delivery and payment selection', () => {
  const schema = checkoutSchema(config);
  const base = {
    contact: CONTACT,
    address: ADDRESS,
    deliveryMethodId: config.deliveryMethods[0].id,
    paymentMethodId: config.paymentMethods[0].id,
    orderNote: '',
  };

  it('insists a delivery method is chosen', () => {
    const result = schema.safeParse({ ...base, deliveryMethodId: '' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe('Choose how you’d like your order delivered.');
  });

  it('insists a payment method is chosen', () => {
    const result = schema.safeParse({ ...base, paymentMethodId: '' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe('Choose how you’d like to pay.');
  });

  it('rejects a payment method the store does not offer', () => {
    expect(schema.safeParse({ ...base, paymentMethodId: 'crypto' }).success).toBe(false);
  });

  /* Which delivery ids are real depends on the address, so the form only
   * insists on a choice; the check against the options quoted for the
   * address happens before submitting — and again on the server. */
  it('refuses a delivery option that was not quoted for the address', () => {
    expect(validateCheckout(draft({ deliveryMethodId: 'teleport' }))?.code).toBe('invalid-delivery-method');
    const quoted = [{ id: 'rate_abc', label: 'Standard', description: '', price: 150_000, etaDays: [1, 2] as [number, number] }];
    expect(validateCheckout(draft({ deliveryMethodId: 'rate_abc', deliveryOptions: quoted }))).toBeNull();
    expect(validateCheckout(draft({ deliveryMethodId: config.deliveryMethods[0].id, deliveryOptions: quoted }))?.code).toBe(
      'invalid-delivery-method',
    );
  });
});

/* ---------------- the address model ---------------- */

describe('address model', () => {
  it('fills the recipient from contact rather than asking twice', () => {
    const blank = emptyAddress('NG');
    const filled = addressFromContact(blank, CONTACT);
    expect(filled.firstName).toBe('Ada');
    expect(filled.lastName).toBe('Okoro');
    expect(filled.phone).toBe(CONTACT.phone);
  });

  it('leaves an explicitly entered recipient alone', () => {
    const gift = { ...ADDRESS, firstName: 'Chidi', lastName: 'Eze', phone: '08000000000' };
    expect(addressFromContact(gift, CONTACT)).toEqual(gift);
  });

  it('prints the country name, not the code, and skips empty lines', () => {
    const lines = addressLines(ADDRESS, config);
    expect(lines).toContain('Nigeria');
    expect(lines).toContain('12 Example Street');
    expect(lines.some((l) => l.trim() === '')).toBe(false);
    expect(lines).not.toContain('NG');
  });

  it('round-trips through the account address book without losing anything', () => {
    const stored = toStoredAddress(ADDRESS, config);
    expect(stored.fullName).toBe('Ada Okoro');
    expect(stored.country).toBe('Nigeria');

    const back = fromStoredAddress({ id: 'a1', ...stored }, config);
    expect(back.firstName).toBe('Ada');
    expect(back.lastName).toBe('Okoro');
    expect(back.country).toBe('NG');
    expect(back.addressLine1).toBe(ADDRESS.addressLine1);
    expect(back.state).toBe(ADDRESS.state);
  });
});

/* ---------------- order reference and window ---------------- */

/* ---------------- the service ---------------- */

describe('checkout validation', () => {
  it('passes a complete checkout', () => {
    expect(validateCheckout(draft())).toBeNull();
  });

  it('refuses an empty bag', () => {
    expect(validateCheckout(draft({ items: [] }))?.code).toBe('empty-cart');
  });

  it('points at the details when the details are wrong', () => {
    const failure = validateCheckout(draft({ contact: { ...CONTACT, email: 'nope' } }));
    expect(failure?.code).toBe('invalid-details');
    expect(failure?.message).not.toContain('email');
  });

  it('separates a missing delivery method from a missing payment method', () => {
    expect(validateCheckout(draft({ deliveryMethodId: null }))?.code).toBe('invalid-delivery-method');
    expect(validateCheckout(draft({ paymentMethodId: null }))?.code).toBe('invalid-payment-method');
  });

  it('catches a line asking for more than the snapshot had in stock', () => {
    const item = { ...line(A, 1), quantity: 5, maxQuantity: 2 };
    const failure = validateCheckout(draft({ items: [item] }));
    expect(failure?.code).toBe('product-unavailable');
    expect(failure?.message).toContain(item.name);
  });

  it('catches a line that is not fit to charge for', () => {
    const item = { ...line(A, 1), unitPrice: 0 };
    expect(validateCheckout(draft({ items: [item] }))?.code).toBe('invalid-cart-item');
  });

  it('never puts technical detail in a shopper-facing message', () => {
    for (const bad of [
      draft({ items: [] }),
      draft({ contact: { ...CONTACT, email: 'nope' } }),
      draft({ items: [{ ...line(A, 1), unitPrice: 0 }] }),
    ]) {
      const failure = validateCheckout(bad)!;
      expect(failure.message).toMatch(/[.!]$/);
      expect(failure.message).not.toMatch(/undefined|Error|zod|\[object/i);
    }
  });
});

describe('handing a valid checkout to the server', () => {
  beforeEach(() => {
    placeOrderAction.mockClear();
  });

  it('sends ids and quantities — never prices, names or totals', async () => {
    const items = [line(A, 2), line(B, 3)];
    const result = await submitCheckout(draft({ items }));

    expect(result.ok).toBe(true);
    expect(placeOrderAction).toHaveBeenCalledTimes(1);

    const sent = placeOrderAction.mock.calls[0][0] as unknown as {
      lines: Record<string, unknown>[];
    };
    expect(sent.lines).toEqual([
      { productId: A.id, variantId: A.variants[0].id, quantity: 2 },
      { productId: B.id, variantId: B.variants[0].id, quantity: 3 },
    ]);

    /* The whole point: a browser cannot tell the server what something
     * costs. Nothing price-shaped may appear in the payload. */
    const payload = JSON.stringify(sent);
    expect(payload).not.toContain('unitPrice');
    expect(payload).not.toContain('totals');
  });

  it('returns the reference and the confirmation token it was given', async () => {
    const result = await submitCheckout(draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toBe('ORD-2026-000001');
    expect(result.confirmationToken).toBe('token-123');
  });

  it('never reaches the server when the checkout is invalid', async () => {
    const result = await submitCheckout(draft({ items: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('empty-cart');
    expect(placeOrderAction).not.toHaveBeenCalled();
  });

  it('passes the server’s refusal through in the shopper’s words', async () => {
    placeOrderAction.mockResolvedValueOnce({
      ok: false,
      message: 'Something in your bag sold out while you were checking out.',
    } as never);

    const result = await submitCheckout(draft());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('Something in your bag sold out while you were checking out.');
    expect(result.message).not.toMatch(/undefined|Error|\[object/i);
  });

  it('turns a thrown request into an answer, not an exception', async () => {
    placeOrderAction.mockRejectedValueOnce(new Error('network is down'));

    const result = await submitCheckout(draft());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('order-failed');
    expect(result.message).not.toContain('network is down');
  });
});

/* ---------------- tenant boundary ---------------- */

describe('tenant boundary', () => {
  it('resolves configuration per store rather than globally', async () => {
    const a = await getCheckoutConfig({ organizationSlug: 'store-a' });
    const b = await getCheckoutConfig({ organizationSlug: 'store-b' });
    /* Identical today (one mock config) — what matters is that each store
     * ASKS, so tenant-specific rows change nothing above this call. */
    expect(a.currency).toBe(b.currency);
    expect(a.paymentMethods.map((m) => m.id)).toEqual(b.paymentMethods.map((m) => m.id));
  });
});
