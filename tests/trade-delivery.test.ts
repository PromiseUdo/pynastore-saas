/*
 * Delivery for trade orders (ROADMAP 21.4), against the real database.
 *
 * A — each buyer is quoted, and charged, only the options meant for them,
 * at their own free-delivery threshold; the public delivery promise never
 * mentions a trade-only option.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutAddress } from '@/lib/storefront/checkout/types';

const session = vi.hoisted(() => ({ shopper: null as null | { id: string; organizationId: string } }));
vi.mock('@/lib/storefront/account/session', async (original) => ({
  ...(await original<typeof import('@/lib/storefront/account/session')>()),
  getShopperForStore: async () => session.shopper,
}));
import { prisma } from '@/lib/prisma';

const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { placeOrder, resolveLines } = await import('@/lib/storefront/orders/create');
const { quoteDelivery, deliveryOverview } = await import('@/lib/storefront/delivery/quote');
const { registerShopper } = await import('@/lib/storefront/account/shopper');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-trade-delivery-${suffix}` };
let buyerId = '';
let shopperId = '';
let riceId = '';
const rates = { standard: '', bike: '', van: '' };

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
  store.id = (await prisma.organization.create({ data: { name: 'Trade Delivery Shop', slug: store.slug, wholesaleMode: 'RETAIL_AND_TRADE' } })).id;
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
  await prisma.inventoryLevel.create({ data: { inventoryItemId: riceId, warehouseId: warehouse.id, quantity: 10_000 } });
  const zone = await prisma.deliveryZone.create({
    data: { organizationId: store.id, warehouseId: warehouse.id, name: 'Nigeria', kind: 'NATIONWIDE' },
  });
  const rate = (data: { name: string; price: number; freeOver?: number; tradeFreeOver?: number; audience?: 'RETAIL' | 'TRADE' }) =>
    prisma.deliveryRate.create({
      data: { organizationId: store.id, zoneId: zone.id, minMinutes: 1440, maxMinutes: 2880, ...data },
      select: { id: true },
    });
  // Free for anyone over ₦50,000 — but for trade buyers only over ₦500,000.
  rates.standard = (await rate({ name: 'Standard', price: 2500, freeOver: 50_000, tradeFreeOver: 500_000 })).id;
  rates.bike = (await rate({ name: 'Express bike', price: 4000, audience: 'RETAIL' })).id;
  rates.van = (await rate({ name: 'Van, next working day', price: 15_000, audience: 'TRADE' })).id;

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
  await prisma.organization.delete({ where: { id: store.id } });
});

beforeEach(() => {
  session.shopper = null;
});

const as = (customerId: string) => (session.shopper = { id: customerId, organizationId: store.id });

async function optionsFor(customerId: string, quantity: number) {
  as(customerId);
  const items = await resolveLines(store.slug, [{ productId: riceId, variantId: riceId, quantity }]);
  const quote = await quoteDelivery(
    store.slug,
    ADDRESS,
    items!.map((item) => ({ itemId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice })),
    { buyer: customerId === buyerId ? 'trade' : 'retail' },
  );
  return quote.options.map((o) => ({ label: o.label, price: o.price }));
}

async function order(customerId: string, quantity: number, deliveryMethodId: string) {
  as(customerId);
  const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { tradeBuyer: customerId === buyerId });
  return placeOrder({
    organizationSlug: store.slug,
    customerId,
    lines: [{ productId: riceId, variantId: riceId, quantity }],
    contact: { firstName: 'Bola', lastName: 'Ade', email: customerId === buyerId ? `bola-${suffix}@example.com` : `chi-${suffix}@example.com`, phone: '08012345678' },
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId: 'pod',
    note: '',
    discountCode: null,
    config,
  });
}

describe('A — options and thresholds by buyer', () => {
  it('quotes each buyer only the options meant for them', async () => {
    expect(await optionsFor(shopperId, 1)).toEqual([
      { label: 'Standard', price: 250_000 },
      { label: 'Express bike', price: 400_000 },
    ]);
    expect(await optionsFor(buyerId, 1)).toEqual([
      { label: 'Standard', price: 250_000 },
      { label: 'Van, next working day', price: 1_500_000 },
    ]);
  });

  it('holds a trade order to the trade threshold, and a retail one to the usual', async () => {
    // ₦72,000 of rice at wholesale: free for retail's threshold, not trade's.
    const trade = await order(buyerId, 9, `rate_${rates.standard}`);
    expect(trade.ok).toBe(true);
    const tradeRow = await prisma.order.findUniqueOrThrow({ where: { id: trade.ok ? trade.orderId : '' }, select: { deliveryFee: true } });
    expect(Number(tradeRow.deliveryFee)).toBe(2500);

    const retail = await order(shopperId, 6, `rate_${rates.standard}`);
    const retailRow = await prisma.order.findUniqueOrThrow({ where: { id: retail.ok ? retail.orderId : '' }, select: { deliveryFee: true } });
    expect(Number(retailRow.deliveryFee)).toBe(0);
  });

  it('refuses an option that isn’t offered to this buyer', async () => {
    expect(await order(shopperId, 1, `rate_${rates.van}`)).toMatchObject({ ok: false, code: 'invalid-delivery-method' });
    expect(await order(buyerId, 1, `rate_${rates.bike}`)).toMatchObject({ ok: false, code: 'invalid-delivery-method' });
  });

  it('never promises a trade-only option publicly', async () => {
    const overview = await deliveryOverview(store.slug);
    // One zone, retail's view: Standard and the bike — never the van, never the trade threshold.
    expect(overview).toHaveLength(1);
    expect(overview[0].price).toBe(250_000);
    expect(overview[0].freeOver).toBe(5_000_000);
  });
});
