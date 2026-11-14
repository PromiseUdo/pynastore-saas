/*
 * Business details and the business invoice (ROADMAP 21.6), against the real
 * database: an approved trade buyer's order carries the business it is made
 * out to — what they typed, or their trade account's — and its invoice is
 * read off the order, by its token, at its own store only. Nobody else's
 * order gets a business, whatever the browser sends.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutAddress, CheckoutBusiness } from '@/lib/storefront/checkout/types';

const session = vi.hoisted(() => ({ shopper: null as null | { id: string; organizationId: string } }));
vi.mock('@/lib/storefront/account/session', async (original) => ({
  ...(await original<typeof import('@/lib/storefront/account/session')>()),
  getShopperForStore: async () => session.shopper,
}));
import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';

const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { placeOrder } = await import('@/lib/storefront/orders/create');
const { registerShopper } = await import('@/lib/storefront/account/shopper');
const { tradeInvoiceByToken, tradeInvoiceForOrder } = await import('@/lib/storefront/orders/trade-invoice');
const { tradeBusinessOnFile } = await import('@/lib/trade/business');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-trade-doc-${suffix}` };
const other = { id: '', slug: `__test-trade-doc-other-${suffix}` };
let buyerId = '';
let shopperId = '';
let riceId = '';
let deliveryMethodId = '';

const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const ADDRESS: CheckoutAddress = {
  firstName: 'Bola',
  lastName: 'Ade',
  phone: '08012345678',
  country: 'NG',
  state: 'Rivers',
  city: 'Port Harcourt',
  addressLine1: '12 Example Street',
  addressLine2: '',
  postalCode: '',
};

beforeAll(async () => {
  store.id = (
    await prisma.organization.create({
      data: {
        name: 'Trade Papers Shop',
        slug: store.slug,
        wholesaleMode: 'RETAIL_AND_TRADE',
        // VAT registered, wholesale quoted before VAT: the invoice shows it added (21.2).
        vatRegistered: true,
        vatRate: 7.5,
        vatNumber: 'VAT-123',
        wholesaleVatAdded: true,
      },
    })
  ).id;
  other.id = (await prisma.organization.create({ data: { name: 'Another Shop', slug: other.slug } })).id;
  const warehouse = await prisma.warehouse.create({ data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' } });
  riceId = (
    await prisma.inventoryItem.create({
      data: {
        organizationId: store.id,
        name: 'Rice (5kg)',
        sku: `rice-${suffix}`.slice(0, 40),
        slug: `rice-${suffix}`.slice(0, 60),
        sellingPrice: 9000,
        wholesalePrice: 8000,
        isPublished: true,
        status: 'ACTIVE',
      },
    })
  ).id;
  await prisma.inventoryLevel.create({ data: { inventoryItemId: riceId, warehouseId: warehouse.id, quantity: 1000 } });
  deliveryMethodId = await giveStoreDelivery(store.id);

  const buyer = await registerShopper({ organizationId: store.id, name: 'Bola Ade', email: `bola-${suffix}@example.com`, password: 'a password here' });
  const shopper = await registerShopper({ organizationId: store.id, name: 'Chi Obi', email: `chi-${suffix}@example.com`, password: 'a password here' });
  if (!buyer.ok || !shopper.ok) throw new Error('setup failed');
  buyerId = buyer.customer.id;
  shopperId = shopper.customer.id;
  await prisma.tradeAccount.create({
    data: { organizationId: store.id, customerId: buyerId, status: 'APPROVED', businessName: 'Bola Stores', cacNumber: 'RC 12345' },
  });
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
  await prisma.orderStockAllocation.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.orderShipment.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.tradeAccount.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.deliveryRate.deleteMany({ where: { organizationId: store.id } });
  await prisma.deliveryZone.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.deleteMany({ where: { id: { in: [store.id, other.id] } } });
});

beforeEach(() => {
  session.shopper = null;
});

async function order(customerId: string, tradeBuyer: boolean, business?: CheckoutBusiness) {
  session.shopper = { id: customerId, organizationId: store.id };
  const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { tradeBuyer });
  const result = await placeOrder({
    organizationSlug: store.slug,
    customerId,
    lines: [{ productId: riceId, variantId: riceId, quantity: 10 }],
    contact: {
      firstName: 'Bola',
      lastName: 'Ade',
      email: customerId === buyerId ? `bola-${suffix}@example.com` : `chi-${suffix}@example.com`,
      phone: '08012345678',
    },
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId: 'pod',
    note: '',
    business: business ?? null,
    discountCode: null,
    config,
  });
  if (!result.ok) throw new Error(`order refused: ${result.message}`);
  return result;
}

const business = (orderId: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { buyerBusinessName: true, buyerTaxId: true, buyerCacNumber: true },
  });

describe('business details at checkout', () => {
  it('fills in a trade buyer’s business from their account', async () => {
    expect(await tradeBusinessOnFile(store.id, buyerId)).toEqual({ name: 'Bola Stores', taxId: '' });
    expect(await tradeBusinessOnFile(store.id, shopperId)).toBeNull();
  });

  it('puts what the buyer left blank from their account onto the order', async () => {
    const placed = await order(buyerId, true, { name: '  ', taxId: '' });
    expect(await business(placed.orderId)).toEqual({ buyerBusinessName: 'Bola Stores', buyerTaxId: null, buyerCacNumber: 'RC 12345' });
  });

  it('uses what the buyer typed, and keeps a first tax ID for next time', async () => {
    const placed = await order(buyerId, true, { name: 'Bola Stores (Aba branch)', taxId: ' 1234-5678 ' });
    expect(await business(placed.orderId)).toEqual({
      buyerBusinessName: 'Bola Stores (Aba branch)',
      buyerTaxId: '1234-5678',
      buyerCacNumber: 'RC 12345',
    });
    expect(await tradeBusinessOnFile(store.id, buyerId)).toEqual({ name: 'Bola Stores', taxId: '1234-5678' });

    // A tax ID on file is never overwritten from checkout.
    await order(buyerId, true, { name: 'Bola Stores', taxId: '9999' });
    expect((await tradeBusinessOnFile(store.id, buyerId))!.taxId).toBe('1234-5678');
  });

  it('gives nobody else’s order a business, whatever was sent', async () => {
    const placed = await order(shopperId, false, { name: 'Pretend Ltd', taxId: '42' });
    expect(await business(placed.orderId)).toEqual({ buyerBusinessName: null, buyerTaxId: null, buyerCacNumber: null });
  });
});

describe('the business invoice', () => {
  it('is the order, written up — with VAT added and the buyer’s tax ID', async () => {
    const placed = await order(buyerId, true, { name: 'Bola Stores', taxId: '' });
    const invoice = await tradeInvoiceByToken(store.id, placed.confirmationToken);
    expect(invoice).toMatchObject({
      number: placed.reference,
      paymentStatus: 'DUE_ON_DELIVERY',
      paymentMethodLabel: 'Pay on delivery',
      seller: { name: 'Trade Papers Shop', vatNumber: 'VAT-123' },
      buyer: { businessName: 'Bola Stores', taxId: '1234-5678', cacNumber: 'RC 12345', contactName: 'Bola Ade' },
      subtotal: 80_000,
      vatAdded: 6_000,
      vatIncluded: 0,
    });
    expect(invoice!.lines).toEqual([
      { name: 'Rice (5kg)', variantName: null, quantity: 10, unitPrice: 8000, totalPrice: 80_000, atWholesalePrice: true },
    ]);
    expect(invoice!.total).toBe(80_000 + 6_000 + (invoice!.deliveryFee ?? 0));
    expect(await tradeInvoiceForOrder(store.id, placed.orderId)).toEqual(invoice);
  });

  it('answers like a wrong link for another store, a wrong token, or a shopper’s order', async () => {
    const trade = await order(buyerId, true);
    const retail = await order(shopperId, false);
    expect(await tradeInvoiceByToken(other.id, trade.confirmationToken)).toBeNull();
    expect(await tradeInvoiceByToken(store.id, 'not-a-token')).toBeNull();
    expect(await tradeInvoiceByToken(store.id, '')).toBeNull();
    expect(await tradeInvoiceByToken(store.id, retail.confirmationToken)).toBeNull();
    expect(await tradeInvoiceForOrder(other.id, trade.orderId)).toBeNull();
  });
});
