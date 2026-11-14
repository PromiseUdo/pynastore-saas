/*
 * Wholesale prices (ROADMAP 21.2), against the real database:
 *
 *   - the catalogue gives an approved trade buyer the wholesale price
 *     (a variant's own, else the product's), and everyone else retail;
 *   - a campaign is retail: it doesn't undercut or replace a wholesale price;
 *   - placing an order charges the wholesale price, records which lines were
 *     wholesale, and adds VAT to them when the shop says its wholesale prices
 *     are before VAT — retail lines in the same bag keep it inside.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';

const session = vi.hoisted(() => ({ shopper: null as null | { id: string; organizationId: string } }));
vi.mock('@/lib/storefront/account/session', async (original) => ({
  ...(await original<typeof import('@/lib/storefront/account/session')>()),
  getShopperForStore: async () => session.shopper,
}));

import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';

const { loadCatalogueFromDb, RETAIL_PRICING } = await import('@/lib/storefront/data/from-prisma');
const { getBuyerPricing } = await import('@/lib/storefront/trade-gate');
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { placeOrder } = await import('@/lib/storefront/orders/create');
const { registerShopper } = await import('@/lib/storefront/account/shopper');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-wholesale-${suffix}` };
let buyerId = '';
let walkerId = '';
let teeId = '';
let teeRed = '';
let teeNavy = '';
let mugId = '';
let deliveryMethodId = '';

// Real orders against real products: the catalogue must read the database.
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const CONTACT: CheckoutContact = { firstName: 'Bola', lastName: 'Ade', email: `bola-${suffix}@example.com`, phone: '08012345678' };
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

const TRADE = { trade: true, vatAdded: false, minOrderValue: null };

beforeAll(async () => {
  store.id = (
    await prisma.organization.create({
      data: { name: 'Wholesale Shop', slug: store.slug, wholesaleMode: 'RETAIL_AND_TRADE', vatRegistered: true, vatRate: 7.5 },
    })
  ).id;
  const warehouse = await prisma.warehouse.create({ data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' } });

  // A tee with two colours: Red has its own wholesale price, Navy uses the product's.
  teeId = (
    await prisma.inventoryItem.create({
      data: {
        organizationId: store.id,
        name: 'Tee',
        sku: `tee-${suffix}`.slice(0, 40),
        slug: `tee-${suffix}`.slice(0, 60),
        sellingPrice: 5000,
        wholesalePrice: 3800,
        isPublished: true,
        status: 'ACTIVE',
        variantOptions: [{ name: 'Colour', kind: 'select', values: [{ label: 'Red' }, { label: 'Navy' }] }],
      },
    })
  ).id;
  for (const [colour, wholesale] of [['Red', 3500], ['Navy', null]] as const) {
    const v = await prisma.inventoryItem.create({
      data: {
        organizationId: store.id,
        parentItemId: teeId,
        itemType: 'VARIANT',
        name: `Tee (${colour})`,
        sku: `tee-${colour}-${suffix}`.slice(0, 40),
        wholesalePrice: wholesale,
        variantAttributes: { Colour: colour },
        status: 'ACTIVE',
      },
    });
    if (colour === 'Red') teeRed = v.id;
    else teeNavy = v.id;
    await prisma.inventoryLevel.create({ data: { inventoryItemId: v.id, warehouseId: warehouse.id, quantity: 100 } });
  }

  // A mug with no wholesale price: trade buyers pay retail for it.
  mugId = (
    await prisma.inventoryItem.create({
      data: {
        organizationId: store.id,
        name: 'Mug',
        sku: `mug-${suffix}`.slice(0, 40),
        slug: `mug-${suffix}`.slice(0, 60),
        sellingPrice: 2150,
        isPublished: true,
        status: 'ACTIVE',
      },
    })
  ).id;
  await prisma.inventoryLevel.create({ data: { inventoryItemId: mugId, warehouseId: warehouse.id, quantity: 100 } });
  deliveryMethodId = await giveStoreDelivery(store.id);

  const buyer = await registerShopper({ organizationId: store.id, name: 'Bola Ade', email: CONTACT.email, password: 'a password here' });
  const walker = await registerShopper({ organizationId: store.id, name: 'Chi Obi', email: `chi-${suffix}@example.com`, password: 'a password here' });
  if (!buyer.ok || !walker.ok) throw new Error('setup failed');
  buyerId = buyer.customer.id;
  walkerId = walker.customer.id;
  await prisma.tradeAccount.create({ data: { organizationId: store.id, customerId: buyerId, status: 'APPROVED', businessName: 'Bola Stores' } });
});

beforeEach(() => {
  session.shopper = null;
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
  await prisma.campaignPrice.deleteMany({ where: { campaign: { organizationId: store.id } } }).catch(() => undefined);
  await prisma.campaign.deleteMany({ where: { organizationId: store.id } }).catch(() => undefined);
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id, parentItemId: { not: null } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.tradeAccount.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.deliveryRate.deleteMany({ where: { organizationId: store.id } });
  await prisma.deliveryZone.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.delete({ where: { id: store.id } });
});

const price = (catalogue: Awaited<ReturnType<typeof loadCatalogueFromDb>>, productId: string, variantId = productId) =>
  catalogue!.products.find((p) => p.id === productId)!.variants.find((v) => v.id === variantId)!;

describe('the catalogue', () => {
  it('gives everyone the retail price', async () => {
    const catalogue = await loadCatalogueFromDb(store.slug, RETAIL_PRICING);
    expect(price(catalogue, teeId, teeRed)).toMatchObject({ price: 500_000 });
    expect(price(catalogue, teeId, teeRed).atWholesale).toBeUndefined();
    expect(catalogue!.products.find((p) => p.id === teeId)!.wholesale).toBeUndefined();
  });

  it('gives a trade buyer the wholesale price — the variant’s own, else the product’s — and retail where there is none', async () => {
    const catalogue = await loadCatalogueFromDb(store.slug, TRADE);
    expect(price(catalogue, teeId, teeRed)).toMatchObject({ price: 350_000, compareAtPrice: null, atWholesale: true });
    expect(price(catalogue, teeId, teeNavy)).toMatchObject({ price: 380_000, atWholesale: true });
    expect(price(catalogue, mugId)).toMatchObject({ price: 215_000 });
    expect(price(catalogue, mugId).atWholesale).toBeUndefined();
    expect(catalogue!.products.find((p) => p.id === teeId)!.wholesale).toEqual({ vatAdded: false });
  });
});

describe('whose prices a request gets', () => {
  it('is wholesale only for an approved trade buyer of this shop', async () => {
    expect(await getBuyerPricing(store.slug)).toEqual(RETAIL_PRICING);
    session.shopper = { id: walkerId, organizationId: store.id };
    expect(await getBuyerPricing(store.slug)).toEqual(RETAIL_PRICING);
    session.shopper = { id: buyerId, organizationId: store.id };
    expect(await getBuyerPricing(store.slug)).toEqual({ trade: true, vatAdded: false, minOrderValue: null });
  });

  it('adds VAT only when the shop chose it and is VAT registered', async () => {
    session.shopper = { id: buyerId, organizationId: store.id };
    await prisma.organization.update({ where: { id: store.id }, data: { wholesaleVatAdded: true } });
    expect(await getBuyerPricing(store.slug)).toEqual({ trade: true, vatAdded: true, minOrderValue: null });
    await prisma.organization.update({ where: { id: store.id }, data: { vatRegistered: false } });
    expect(await getBuyerPricing(store.slug)).toEqual({ trade: true, vatAdded: false, minOrderValue: null });
    await prisma.organization.update({ where: { id: store.id }, data: { vatRegistered: true, wholesaleVatAdded: false } });
  });
});

describe('placing a trade order', () => {
  it('charges the wholesale price, marks the line, and adds VAT only to it', async () => {
    session.shopper = { id: buyerId, organizationId: store.id };
    await prisma.organization.update({ where: { id: store.id }, data: { wholesaleVatAdded: true } });
    const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { tradeBuyer: true });
    expect(config.vat?.addedToWholesale).toBe(true);

    const result = await placeOrder({
      organizationSlug: store.slug,
      customerId: buyerId,
      lines: [
        { productId: teeId, variantId: teeRed, quantity: 2 },
        { productId: mugId, variantId: mugId, quantity: 1 },
      ],
      contact: CONTACT,
      address: ADDRESS,
      deliveryMethodId,
      paymentMethodId: 'pod',
      note: '',
      discountCode: null,
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId }, include: { lineItems: true } });
    const tee = order.lineItems.find((l) => l.variantId === teeRed)!;
    const mug = order.lineItems.find((l) => l.variantId === mugId)!;
    expect(Number(tee.unitPrice)).toBe(3500);
    expect(tee.atWholesalePrice).toBe(true);
    expect(Number(mug.unitPrice)).toBe(2150);
    expect(mug.atWholesalePrice).toBe(false);

    // ₦7,000 of wholesale goods: ₦525 VAT added. The ₦2,150 mug already includes ₦150.
    expect(Number(order.vatAddedAmount)).toBe(525);
    expect(Number(order.taxAmount)).toBe(675);
    expect(Number(order.totalAmount)).toBe(7000 + 2150 + 525 + Number(order.deliveryFee));
    await prisma.organization.update({ where: { id: store.id }, data: { wholesaleVatAdded: false } });
  });

  it('charges a shopper who isn’t a trade buyer retail, whatever they claim', async () => {
    session.shopper = { id: walkerId, organizationId: store.id };
    const config = await getStoreCheckoutConfig({ organizationSlug: store.slug });
    const result = await placeOrder({
      organizationSlug: store.slug,
      customerId: walkerId,
      lines: [{ productId: teeId, variantId: teeRed, quantity: 1 }],
      contact: { ...CONTACT, email: `chi-${suffix}@example.com` },
      address: ADDRESS,
      deliveryMethodId,
      paymentMethodId: 'pod',
      note: '',
      discountCode: null,
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = await prisma.orderLineItem.findFirstOrThrow({ where: { orderId: result.orderId } });
    expect(Number(line.unitPrice)).toBe(5000);
    expect(line.atWholesalePrice).toBe(false);
  });
});
