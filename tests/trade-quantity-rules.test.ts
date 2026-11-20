/*
 * Trade quantity rules (ROADMAP 21.3), against the real database: the
 * catalogue gives an approved trade buyer the product's minimum and pack
 * size, and placing an order holds them — and the shop's minimum order —
 * while a shopper who isn't a trade buyer is never touched by them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { givePlan, dropBilling } from './helpers/plans';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';

// Placing an order finds the buyer from their session, as in the shop.
const session = vi.hoisted(() => ({ shopper: null as null | { id: string; organizationId: string } }));
vi.mock('@/lib/storefront/account/session', async (original) => ({
  ...(await original<typeof import('@/lib/storefront/account/session')>()),
  getShopperForStore: async () => session.shopper,
}));
import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';

const { loadCatalogueFromDb, RETAIL_PRICING } = await import('@/lib/storefront/data/from-prisma');
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { placeOrder } = await import('@/lib/storefront/orders/create');
const { registerShopper } = await import('@/lib/storefront/account/shopper');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-trade-qty-${suffix}` };
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
const contact = (email: string): CheckoutContact => ({ firstName: 'Bola', lastName: 'Ade', email, phone: '08012345678' });

const TRADE = { trade: true, vatAdded: false, minOrderValue: null };

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Trade Rules Shop', slug: store.slug, wholesaleMode: 'RETAIL_AND_TRADE' } })).id;
  await givePlan(store.id); // Wholesale is a plan feature (22.1)
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
        tradeMinQuantity: 20,
        tradePackSize: 10,
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
  await prisma.tradeAccount.create({ data: { organizationId: store.id, customerId: buyerId, status: 'APPROVED', businessName: 'Bola Stores' } });
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
  await dropBilling(store.id);
  await prisma.organization.delete({ where: { id: store.id } });
});

async function order(customerId: string, quantity: number, tradeBuyer: boolean) {
  const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { tradeBuyer });
  return placeOrder({
    organizationSlug: store.slug,
    customerId,
    lines: [{ productId: riceId, variantId: riceId, quantity }],
    contact: contact(customerId === buyerId ? `bola-${suffix}@example.com` : `chi-${suffix}@example.com`),
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId: 'pod',
    note: '',
    discountCode: null,
    config,
  });
}

describe('the catalogue', () => {
  it('gives a wholesaler the product’s rules, and nobody else any', async () => {
    const trade = await loadCatalogueFromDb(store.slug, TRADE);
    expect(trade!.products.find((p) => p.id === riceId)!.trade).toEqual({ minQuantity: 20, packSize: 10 });
    const retail = await loadCatalogueFromDb(store.slug, RETAIL_PRICING);
    expect(retail!.products.find((p) => p.id === riceId)!.trade).toBeUndefined();
  });
});

beforeEach(() => {
  session.shopper = null;
});

describe('placing an order', () => {
  const as = (customerId: string) => (session.shopper = { id: customerId, organizationId: store.id });

  it('refuses a wholesaler’s order under the product’s minimum', async () => {
    as(buyerId);
    const result = await order(buyerId, 10, true);
    expect(result).toMatchObject({ ok: false, code: 'trade-rules', message: 'Rice (5kg): order at least 20 (you have 10).' });
  });

  it('refuses a part pack', async () => {
    as(buyerId);
    const result = await order(buyerId, 25, true);
    expect(result).toMatchObject({ ok: false, code: 'trade-rules' });
    expect(!result.ok && result.message).toContain('packs of 10');
  });

  it('lets a wholesaler order more than 99, in whole packs, at the wholesale price', async () => {
    as(buyerId);
    const result = await order(buyerId, 150, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = await prisma.orderLineItem.findFirstOrThrow({ where: { orderId: result.orderId } });
    expect(line.quantity).toBe(150);
    expect(Number(line.unitPrice)).toBe(8000);
  });

  it('holds the shop’s minimum wholesale order', async () => {
    as(buyerId);
    await prisma.organization.update({ where: { id: store.id }, data: { tradeMinOrderValue: 500_000 } });
    const result = await order(buyerId, 20, true);
    expect(result).toMatchObject({ ok: false, code: 'trade-rules' });
    expect(!result.ok && result.message).toContain('Wholesale orders start at');
    await prisma.organization.update({ where: { id: store.id }, data: { tradeMinOrderValue: null } });
  });

  it('never applies any of it to a shopper who isn’t a wholesaler', async () => {
    as(shopperId);
    const one = await order(shopperId, 1, false);
    expect(one.ok).toBe(true);
    // …who still stops at 99 a line.
    const lots = await order(shopperId, 150, false);
    expect(lots).toMatchObject({ ok: false, code: 'product-unavailable' });
  });
});
