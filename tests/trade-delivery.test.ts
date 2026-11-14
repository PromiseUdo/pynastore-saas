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
  await prisma.auditLog.deleteMany({ where: { organizationId: store.id } });
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

/*
 * B — "delivery to be arranged": offered to a trade buyer whose bag is big
 * enough, placed with nothing to pay, priced by the store, accepted by the
 * buyer, and cancelled (stock released) when either side runs out of time.
 */
describe('B — delivery to be arranged', () => {
  let arranged: typeof import('@/lib/storefront/orders/arranged');
  let lifecycle: typeof import('@/lib/storefront/orders/lifecycle');
  let arrangedId = '';

  beforeAll(async () => {
    arranged = await import('@/lib/storefront/orders/arranged');
    lifecycle = await import('@/lib/storefront/orders/lifecycle');
    const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: store.id } });
    await prisma.warehouse.update({
      where: { id: warehouse.id },
      data: { arrangedDeliveryOn: true, arrangedDeliveryFromValue: 500_000, arrangedPriceHours: 24 },
    });
    arrangedId = `arranged_${warehouse.id}`;
    // So the shop offers payment by transfer.
    await prisma.merchantBankAccount.create({
      data: { organizationId: store.id, bankName: 'GTBank', accountName: 'Trade Delivery Shop', accountNumber: '0123456789' },
    });
  });

  const ids = async (customerId: string, quantity: number) => {
    as(customerId);
    const items = await resolveLines(store.slug, [{ productId: riceId, variantId: riceId, quantity }]);
    const quote = await quoteDelivery(
      store.slug,
      ADDRESS,
      items!.map((item) => ({ itemId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice })),
      { buyer: customerId === buyerId ? 'trade' : 'retail' },
    );
    return quote.options.map((o) => o.id);
  };

  async function placeArranged(paymentMethodId = 'pod') {
    as(buyerId);
    const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { tradeBuyer: true });
    const result = await placeOrder({
      organizationSlug: store.slug,
      customerId: buyerId,
      // 70 × ₦8,000 = ₦560,000 of goods: over the store's ₦500,000.
      lines: [{ productId: riceId, variantId: riceId, quantity: 70 }],
      contact: { firstName: 'Bola', lastName: 'Ade', email: `bola-${suffix}@example.com`, phone: '08012345678' },
      address: ADDRESS,
      deliveryMethodId: arrangedId,
      paymentMethodId,
      note: '',
      discountCode: null,
      config,
    });
    if (!result.ok) throw new Error(`refused: ${result.message}`);
    return result;
  }

  const row = (id: string) =>
    prisma.order.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        paymentStatus: true,
        totalAmount: true,
        deliveryFee: true,
        deliveryArranged: true,
        deliveryPriceDueAt: true,
        deliveryAcceptBy: true,
        deliveryPriceRemindedAt: true,
        cancelReason: true,
        allocations: { select: { status: true } },
      },
    });

  it('is offered only to a trade buyer, and only for a big enough bag', async () => {
    expect(await ids(buyerId, 70)).toContain(arrangedId);
    expect(await ids(buyerId, 10)).not.toContain(arrangedId);
    expect(await ids(shopperId, 70)).not.toContain(arrangedId);
  });

  it('is placed with nothing to pay, no fee, the stock held and a pricing deadline', async () => {
    const placed = await placeArranged();
    expect(placed.deliveryArranged).toBe(true);
    const order = await row(placed.orderId);
    expect(order).toMatchObject({ status: 'PENDING', paymentStatus: 'AWAITING_DELIVERY_PRICE', deliveryArranged: true, deliveryFee: null });
    expect(Number(order.totalAmount)).toBe(560_000);
    expect(order.deliveryPriceDueAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(order.allocations.length).toBeGreaterThan(0);
    // Nothing can go ahead before it's priced and accepted.
    expect(await lifecycle.confirmOrder({ organizationId: store.id, orderId: placed.orderId })).toMatchObject({ ok: false });
  });

  it('is priced by the store (and re-priced), then accepted by the buyer once', async () => {
    const placed = await placeArranged();
    const price = (fee: number, note?: string) =>
      arranged.priceArrangedDelivery({ organizationId: store.id, orderId: placed.orderId, fee, note, userId: null });

    expect(await price(45_000, 'Our truck, Thursday')).toEqual({ ok: true });
    expect(Number((await row(placed.orderId)).totalAmount)).toBe(605_000);
    expect(await price(40_000)).toEqual({ ok: true });
    const priced = await row(placed.orderId);
    expect(Number(priced.totalAmount)).toBe(600_000);
    expect(Number(priced.deliveryFee)).toBe(40_000);
    expect(priced.paymentStatus).toBe('AWAITING_DELIVERY_PRICE');
    expect(priced.deliveryAcceptBy).not.toBeNull();

    // Another store can't price it.
    expect(
      await arranged.priceArrangedDelivery({ organizationId: 'someone-else', orderId: placed.orderId, fee: 1, userId: null }),
    ).toMatchObject({ ok: false });

    const token = (await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId }, select: { confirmationToken: true } })).confirmationToken!;
    expect(await arranged.acceptArrangedDelivery({ organizationId: store.id, confirmationToken: token })).toMatchObject({ ok: true, paymentMethod: 'pod' });
    expect((await row(placed.orderId)).paymentStatus).toBe('DUE_ON_DELIVERY');
    // Accepted: the price is settled.
    expect(await price(99_000)).toMatchObject({ ok: false });
    expect(await lifecycle.confirmOrder({ organizationId: store.id, orderId: placed.orderId })).toEqual({ ok: true });
  });

  it('can’t be accepted before it’s priced; a transfer starts its window on acceptance', async () => {
    const placed = await placeArranged('transfer');
    const token = (await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId }, select: { confirmationToken: true } })).confirmationToken!;
    expect(await arranged.acceptArrangedDelivery({ organizationId: store.id, confirmationToken: token })).toMatchObject({ ok: false });
    await arranged.priceArrangedDelivery({ organizationId: store.id, orderId: placed.orderId, fee: 30_000, userId: null });
    // Accepted long after it was placed: the transfer hold runs from now, so the expiry job leaves it alone.
    await prisma.order.update({ where: { id: placed.orderId }, data: { placedAt: new Date(Date.now() - 30 * 24 * 3_600_000) } });
    expect(await arranged.acceptArrangedDelivery({ organizationId: store.id, confirmationToken: token })).toMatchObject({ ok: true });
    await lifecycle.expireUnpaidOrders({ organizationId: store.id });
    expect(await row(placed.orderId)).toMatchObject({ status: 'PENDING', paymentStatus: 'AWAITING_TRANSFER' });
  });

  it('reminds the store once near its deadline, then cancels and releases the stock if it isn’t priced', async () => {
    const placed = await placeArranged();
    await prisma.order.update({ where: { id: placed.orderId }, data: { deliveryPriceDueAt: new Date(Date.now() + 3_600_000) } });
    expect(await arranged.remindArrangedPricing({ organizationId: store.id }, 4)).toBe(1);
    expect(await arranged.remindArrangedPricing({ organizationId: store.id }, 4)).toBe(0);
    expect((await row(placed.orderId)).deliveryPriceRemindedAt).not.toBeNull();

    await prisma.order.update({ where: { id: placed.orderId }, data: { deliveryPriceDueAt: new Date(Date.now() - 60_000) } });
    await lifecycle.expireUnpaidOrders({ organizationId: store.id });
    const order = await row(placed.orderId);
    expect(order).toMatchObject({ status: 'CANCELLED', cancelReason: 'delivery-not-priced' });
    expect(order.allocations.every((a) => a.status === 'RELEASED')).toBe(true);
  });

  it('cancels a priced order the buyer didn’t accept in time', async () => {
    const placed = await placeArranged();
    await arranged.priceArrangedDelivery({ organizationId: store.id, orderId: placed.orderId, fee: 20_000, userId: null });
    await prisma.order.update({ where: { id: placed.orderId }, data: { deliveryAcceptBy: new Date(Date.now() - 60_000) } });
    await lifecycle.expireUnpaidOrders({ organizationId: store.id });
    expect(await row(placed.orderId)).toMatchObject({ status: 'CANCELLED', cancelReason: 'delivery-not-accepted' });
  });
});
