/*
 * Placing and reading orders, against the real database.
 *
 * The rules that matter most here are the ones a browser must not be able to
 * bend: the price is the merchant's, the store is the one the request came
 * to, and an order is readable only by the person it belongs to — or by
 * someone who knows both its reference and the email it was placed with.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';
import { registerShopper } from '@/lib/storefront/account/shopper';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { placeOrder } from '@/lib/storefront/orders/create';
import { releaseOrderStock } from '@/lib/storefront/orders/stock';
import { cancelOrder } from '@/lib/storefront/orders/lifecycle';
import {
  findOrderByReferenceAndEmail,
  getOrderByConfirmationToken,
  getOrderForCustomer,
  listOrdersForCustomer,
} from '@/lib/storefront/orders/read';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-orders-${suffix}` };
const other = { id: '', slug: `__test-orders-other-${suffix}` };

let customerId = '';
let productId = '';
let variantId = '';
let foreignProductId = '';

/*
 * These tests place REAL orders against REAL products, so the catalogue must
 * read the database rather than the demo fixtures it uses everywhere else —
 * an order line is a foreign key into the merchant's catalogue, and a
 * fixture id has nothing to point at. See lib/storefront/data/current.ts.
 */
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const config = await getCheckoutConfig({ organizationSlug: 'demo' });

const CONTACT: CheckoutContact = {
  firstName: 'Ada',
  lastName: 'Okoro',
  email: `ada-${suffix}@example.com`,
  phone: '08012345678',
};

const ADDRESS: CheckoutAddress = {
  firstName: 'Ada',
  lastName: 'Okoro',
  phone: '08012345678',
  country: config.defaultCountryCode,
  state: 'Rivers',
  city: 'Port Harcourt',
  addressLine1: '12 Example Street',
  addressLine2: '',
  postalCode: '',
};

/*
 * A published product with stock in a store that sells online — the same
 * conditions the catalogue requires, because `placeOrder` re-prices through
 * the catalogue and would refuse anything a shopper couldn't have bought.
 */
async function makeSellableProduct(organizationId: string, name: string, priceMajor: number) {
  const warehouse = await prisma.warehouse.create({
    data: { organizationId, name: `${name} Store`, sellsOnline: true, status: 'ACTIVE' },
  });

  const item = await prisma.inventoryItem.create({
    data: {
      organizationId,
      name,
      sku: `${name}-${suffix}`.slice(0, 40),
      slug: `${name.toLowerCase()}-${suffix}`.slice(0, 60),
      sellingPrice: priceMajor,
      isPublished: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  await prisma.inventoryLevel.create({
    // Deep enough that a suite of orders two-at-a-time never runs it dry.
    data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 250 },
  });

  return item.id;
}

const baseInput = () => ({
  organizationSlug: store.slug,
  customerId: null as string | null,
  lines: [{ productId, variantId, quantity: 2 }],
  contact: CONTACT,
  address: ADDRESS,
  deliveryMethodId,
  paymentMethodId: config.paymentMethods[0].id,
  note: '',
  config,
});

let deliveryMethodId = '';

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Orders Store', slug: store.slug } })).id;
  deliveryMethodId = await giveStoreDelivery(store.id);
  other.id = (await prisma.organization.create({ data: { name: 'Other Store', slug: other.slug } })).id;

  const shopper = await registerShopper({
    organizationId: store.id,
    name: 'Ada Okoro',
    email: CONTACT.email,
    password: 'a password here',
  });
  if (!shopper.ok) throw new Error('setup failed');
  customerId = shopper.customer.id;

  productId = await makeSellableProduct(store.id, 'Tote', 5000);
  // A product with no variants of its own sells as itself.
  variantId = productId;
  foreignProductId = await makeSellableProduct(other.id, 'Foreign', 9000);
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;

  for (const org of [store, other]) {
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: org.id } } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.discountCode.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockMovement.deleteMany({ where: { organizationId: org.id } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: org.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('placing an order', () => {
  it('writes it with a readable reference and an unguessable token', async () => {
    const result = await placeOrder({ ...baseInput(), customerId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(result.confirmationToken.length).toBeGreaterThan(30);
    expect(result.confirmationToken).not.toContain(result.reference);
  });

  it('prices the order from the catalogue, not from anything a browser sent', async () => {
    const result = await placeOrder({ ...baseInput(), customerId });
    if (!result.ok) throw new Error('order failed');

    const order = await getOrderForCustomer({ organizationId: store.id }, customerId, result.reference);

    // ₦5,000 × 2 — the price on the product, in kobo.
    expect(order!.lines[0].unitPrice).toBe(500_000);
    expect(order!.totals.subtotal).toBe(1_000_000);
    /* VAT is included in the listed price rather than added to it
     * (lib/storefront/pricing.ts), so it is a memo inside the subtotal — the
     * total is goods plus delivery, and nothing else. */
    expect(order!.totals.total).toBe(
      order!.totals.subtotal - order!.totals.discount + order!.totals.shipping,
    );
    expect(order!.totals.tax).toBeGreaterThan(0);
    expect(order!.totals.tax).toBeLessThan(order!.totals.subtotal);
  });

  it('keeps a snapshot of what was bought and where it was sent', async () => {
    const result = await placeOrder({ ...baseInput(), customerId, note: 'Leave with security' });
    if (!result.ok) throw new Error('order failed');

    const order = await getOrderForCustomer({ organizationId: store.id }, customerId, result.reference);

    expect(order!.lines[0].name).toBe('Tote');
    expect(order!.lines[0].quantity).toBe(2);
    expect(order!.shippingAddress.line1).toBe('12 Example Street');
    expect(order!.shippingAddress.city).toBe('Port Harcourt');
    expect(order!.note).toBe('Leave with security');
    expect(order!.contact.email).toBe(CONTACT.email.toLowerCase());
  });

  it('never records an order as paid', async () => {
    for (const method of config.paymentMethods) {
      const result = await placeOrder({ ...baseInput(), customerId, paymentMethodId: method.id });
      if (!result.ok) throw new Error('order failed');

      const order = await getOrderForCustomer({ organizationId: store.id }, customerId, result.reference);
      expect(order!.paymentStatus).not.toBe('PAID');
      expect(['AWAITING_PAYMENT', 'AWAITING_TRANSFER', 'DUE_ON_DELIVERY']).toContain(
        order!.paymentStatus,
      );
    }
  });

  it('refuses a product from another merchant’s catalogue', async () => {
    const result = await placeOrder({
      ...baseInput(),
      customerId,
      lines: [{ productId: foreignProductId, variantId: foreignProductId, quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('product-unavailable');
  });

  it('refuses an empty bag, an unknown delivery option and an unknown payment option', async () => {
    await expect(placeOrder({ ...baseInput(), lines: [] })).resolves.toMatchObject({
      ok: false,
      code: 'empty-cart',
    });
    await expect(
      placeOrder({ ...baseInput(), deliveryMethodId: 'teleport' }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-delivery-method' });
    await expect(
      placeOrder({ ...baseInput(), paymentMethodId: 'goats' }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-payment-method' });
  });

  it('refuses more than there is in stock', async () => {
    await expect(
      placeOrder({ ...baseInput(), lines: [{ productId, variantId, quantity: 999 }] }),
    ).resolves.toMatchObject({ ok: false, code: 'product-unavailable' });
  });

  it('gives every order in a store its own reference', async () => {
    const orders = await listOrdersForCustomer({ organizationId: store.id }, customerId);
    const references = new Set(orders.map((order) => order.reference));
    expect(references.size).toBe(orders.length);
  });

  it('keeps numbering orders after an earlier one is deleted', async () => {
    const first = await placeOrder(baseInput());
    const second = await placeOrder(baseInput());
    if (!first.ok || !second.ok) throw new Error('setup failed');

    // A deleted order leaves a gap; the next number must not reuse a taken one.
    await prisma.$transaction((tx) => releaseOrderStock(tx, first.orderId));
    await prisma.orderStockAllocation.deleteMany({ where: { orderId: first.orderId } });
    await prisma.orderLineItem.deleteMany({ where: { orderId: first.orderId } });
    await prisma.order.delete({ where: { id: first.orderId } });

    const third = await placeOrder(baseInput());
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    const n = (reference: string) => Number(reference.split('-').at(-1));
    expect(n(third.reference)).toBe(n(second.reference) + 1);
  });
});

describe('a guest order', () => {
  it('still gets a customer record, so the merchant sees a person', async () => {
    const email = `guest-${suffix}@example.com`;
    const result = await placeOrder({
      ...baseInput(),
      customerId: null,
      contact: { ...CONTACT, email },
    });
    if (!result.ok) throw new Error('order failed');

    const created = await prisma.customer.findUnique({
      where: { organizationId_email: { organizationId: store.id, email } },
      select: { id: true, name: true },
    });

    expect(created).not.toBeNull();
    expect(created!.name).toBe('Ada Okoro');

    const order = await prisma.order.findFirst({
      where: { reference: result.reference, organizationId: store.id },
      select: { isGuest: true, customerId: true },
    });
    expect(order!.isGuest).toBe(true);
    expect(order!.customerId).toBe(created!.id);
  });

  it('can be found with its reference AND email, and not with either alone', async () => {
    const email = `lookup-${suffix}@example.com`;
    const result = await placeOrder({
      ...baseInput(),
      customerId: null,
      contact: { ...CONTACT, email },
    });
    if (!result.ok) throw new Error('order failed');

    const scope = { organizationId: store.id };

    await expect(
      findOrderByReferenceAndEmail(scope, result.reference, email.toUpperCase()),
    ).resolves.toMatchObject({ reference: result.reference });

    // The wrong email reads exactly like a missing order.
    await expect(
      findOrderByReferenceAndEmail(scope, result.reference, 'someone@else.example'),
    ).resolves.toBeNull();
    await expect(findOrderByReferenceAndEmail(scope, 'ORD-2026-999999', email)).resolves.toBeNull();
  });
});

describe('who may read an order', () => {
  it('opens on its confirmation token, and never on the reference', async () => {
    const result = await placeOrder({ ...baseInput(), customerId });
    if (!result.ok) throw new Error('order failed');

    const scope = { organizationId: store.id };

    await expect(
      getOrderByConfirmationToken(scope, result.confirmationToken),
    ).resolves.toMatchObject({ reference: result.reference });

    /* The reference counts upwards — if it opened the confirmation, the
     * store's whole order book would open with it. */
    await expect(getOrderByConfirmationToken(scope, result.reference)).resolves.toBeNull();
    await expect(getOrderByConfirmationToken(scope, '')).resolves.toBeNull();
  });

  it('is invisible to another store, token and all', async () => {
    const result = await placeOrder({ ...baseInput(), customerId });
    if (!result.ok) throw new Error('order failed');

    const elsewhere = { organizationId: other.id };

    await expect(
      getOrderByConfirmationToken(elsewhere, result.confirmationToken),
    ).resolves.toBeNull();
    await expect(
      findOrderByReferenceAndEmail(elsewhere, result.reference, CONTACT.email),
    ).resolves.toBeNull();
    await expect(
      getOrderForCustomer(elsewhere, customerId, result.reference),
    ).resolves.toBeNull();
  });

  it('is invisible to another shopper in the same store', async () => {
    const result = await placeOrder({ ...baseInput(), customerId });
    if (!result.ok) throw new Error('order failed');

    const stranger = await registerShopper({
      organizationId: store.id,
      name: 'Someone Else',
      email: `stranger-${suffix}@example.com`,
      password: 'a password here',
    });
    if (!stranger.ok) throw new Error('setup failed');

    await expect(
      getOrderForCustomer({ organizationId: store.id }, stranger.customer.id, result.reference),
    ).resolves.toBeNull();
    await expect(
      listOrdersForCustomer({ organizationId: store.id }, stranger.customer.id),
    ).resolves.toEqual([]);
  });
});

/*
 * Discount codes, against the merchant's real records.
 *
 * The bag screen's answer is a preview over a snapshot a browser is holding.
 * These are the checks that decide what the customer is charged.
 */
describe('discount codes', () => {
  async function makeCode(overrides: Partial<{
    code: string;
    label: string;
    kind: 'PERCENT' | 'FIXED';
    value: number;
    minSubtotal: number | null;
    endsAt: Date | null;
    usageLimit: number | null;
    perCustomerLimit: number | null;
    isActive: boolean;
  }> = {}) {
    return prisma.discountCode.create({
      data: {
        organizationId: store.id,
        code: `TEST${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        label: '10% off',
        kind: 'PERCENT',
        value: 10,
        ...overrides,
      },
    });
  }

  it('takes the discount off the goods and records which code did it', async () => {
    const discount = await makeCode();

    const result = await placeOrder({ ...baseInput(), customerId, discountCode: discount.code });
    if (!result.ok) throw new Error(result.message);

    const order = await getOrderForCustomer({ organizationId: store.id }, customerId, result.reference);
    // ₦10,000 of goods, 10% off.
    expect(order!.totals.subtotal).toBe(1_000_000);
    expect(order!.totals.discount).toBe(100_000);
    expect(order!.totals.total).toBe(900_000 + order!.totals.shipping);
    expect(order!.discountCode).toBe(discount.code);
  });

  it('accepts the code however the shopper typed it', async () => {
    const discount = await makeCode();

    const result = await placeOrder({
      ...baseInput(),
      customerId,
      discountCode: `  ${discount.code.toLowerCase()} `,
    });
    expect(result.ok).toBe(true);
  });

  it('counts one use per order, and stops at the limit', async () => {
    const discount = await makeCode({ usageLimit: 1 });

    const first = await placeOrder({ ...baseInput(), customerId, discountCode: discount.code });
    expect(first.ok).toBe(true);

    const second = await placeOrder({ ...baseInput(), customerId, discountCode: discount.code });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('invalid-discount');

    const after = await prisma.discountCode.findUnique({ where: { id: discount.id } });
    expect(after!.usageCount).toBe(1);
  });

  it('refuses a second use of a once-per-customer code', async () => {
    const discount = await makeCode({ perCustomerLimit: 1 });

    expect((await placeOrder({ ...baseInput(), customerId, discountCode: discount.code })).ok).toBe(true);
    const second = await placeOrder({ ...baseInput(), customerId, discountCode: discount.code });
    expect(second.ok === false && second.code).toBe('invalid-discount');
  });

  it('refuses a code that is off, expired, or below its minimum spend', async () => {
    const off = await makeCode({ isActive: false });
    const expired = await makeCode({ endsAt: new Date('2020-01-01') });
    // The bag is ₦10,000; this wants ₦50,000.
    const tooSmall = await makeCode({ kind: 'FIXED', value: 2000, minSubtotal: 50_000 });

    for (const discount of [off, expired, tooSmall]) {
      const result = await placeOrder({ ...baseInput(), customerId, discountCode: discount.code });
      expect(result.ok === false && result.code).toBe('invalid-discount');
    }
  });

  it('refuses another store’s code, and never charges it here', async () => {
    const foreign = await prisma.discountCode.create({
      data: { organizationId: other.id, code: `OTHER${suffix.slice(-4).toUpperCase()}`, label: '50% off', kind: 'PERCENT', value: 50 },
    });

    const result = await placeOrder({ ...baseInput(), customerId, discountCode: foreign.code });
    expect(result.ok === false && result.code).toBe('invalid-discount');

    const untouched = await prisma.discountCode.findUnique({ where: { id: foreign.id } });
    expect(untouched!.usageCount).toBe(0);
  });

  it('gives the use back when the order is cancelled', async () => {
    const discount = await makeCode({ usageLimit: 1 });

    const first = await placeOrder({ ...baseInput(), customerId, discountCode: discount.code });
    if (!first.ok) throw new Error(first.message);
    expect((await prisma.discountCode.findUnique({ where: { id: discount.id } }))!.usageCount).toBe(1);

    expect(await cancelOrder({ organizationId: store.id, orderId: first.orderId })).toEqual({ ok: true });
    expect((await prisma.discountCode.findUnique({ where: { id: discount.id } }))!.usageCount).toBe(0);

    // …so the last use of a limited code isn't lost to an abandoned order.
    const second = await placeOrder({ ...baseInput(), customerId, discountCode: discount.code });
    expect(second.ok).toBe(true);
  });

  it('places the order at full price when no code is given', async () => {
    const result = await placeOrder({ ...baseInput(), customerId });
    if (!result.ok) throw new Error(result.message);

    const order = await getOrderForCustomer({ organizationId: store.id }, customerId, result.reference);
    expect(order!.totals.discount).toBe(0);
    expect(order!.discountCode).toBeNull();
  });
});
