// Merchant delivery settings, and orders priced from them — real DB, mocked org context.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Delivery Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: {
    id: 'm',
    role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] },
    /** Empty = every store (Phase 8.6); the parcel cases narrow it. */
    warehouseIds: [] as string[],
  },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendLowStockAlertEmail: vi.fn(async () => {}),
}));

const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const {
  saveDeliveryZone,
  saveDeliveryRate,
  deleteDeliveryRate,
  savePickupLocation,
  deleteDeliveryZone,
  createSuggestedDelivery,
  getDeliverySettings,
  previewDelivery,
  confirmStoreDelivery,
  saveConsolidationPolicy,
} = await import('@/features/settings/delivery');
const { sendOrderTransfer, receiveTransfer } = await import('@/features/inventory/transfers');
const { quotedDeliveryId } = await import('./helpers/delivery');
const { estimateDelivery, cleanDeliverTo } = await import('@/lib/storefront/delivery/estimate');
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { getStoreOrder, updateStoreOrder, updateStoreShipment } = await import('@/features/sales/orders');
const { confirmOrder } = await import('@/lib/storefront/orders/lifecycle');
const { placeOrder } = await import('@/lib/storefront/orders/create');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let productId = '';
/** the one store that sells online at the start; the multi-store cases add Lagos */
let mainId = '';

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

const ADDRESS = (state: string, city: string) => ({
  firstName: 'Ada',
  lastName: 'Okoro',
  phone: '08012345678',
  country: 'NG',
  state,
  city,
  addressLine1: '1 Test Street',
  addressLine2: '',
  postalCode: '',
});

async function order(state: string, city: string, deliveryMethodId: string, quantity = 1, item = productId) {
  const config = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
  return placeOrder({
    organizationSlug: ctx.organization.slug,
    customerId: null,
    lines: [{ productId: item, variantId: item, quantity }],
    contact: { firstName: 'Ada', lastName: 'Okoro', email: `ada-del-${suffix}@example.com`, phone: '08012345678' },
    address: ADDRESS(state, city),
    deliveryMethodId,
    paymentMethodId: 'pod',
    note: '',
    config,
  });
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: 'Delivery Test', slug: `__test-delivery-${suffix}` } });
  ctx.organization.id = org.id;
  ctx.organization.slug = org.slug;
  ctx.membership.role.permissions = [
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_EDIT,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_FULFILLMENT_MANAGE,
    PERMISSIONS.INVENTORY_MOVEMENT_CREATE,
  ];

  const warehouse = await prisma.warehouse.create({
    data: { organizationId: org.id, name: 'Main', sellsOnline: true, status: 'ACTIVE', state: 'Rivers', city: 'Port Harcourt' },
  });
  mainId = warehouse.id;
  productId = (
    await prisma.inventoryItem.create({
      data: {
        organizationId: org.id,
        name: 'Tote',
        sku: `TOTE-DEL-${suffix}`.slice(0, 40),
        slug: `tote-del-${suffix}`.slice(0, 60),
        sellingPrice: 10000,
        isPublished: true,
        status: 'ACTIVE',
      },
    })
  ).id;
  await prisma.inventoryLevel.create({ data: { inventoryItemId: productId, warehouseId: warehouse.id, quantity: 50 } });
});

afterAll(async () => {
  const organizationId = ctx.organization.id;
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
  await prisma.orderStockAllocation.deleteMany({ where: { organizationId } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId } } });
  await prisma.order.deleteMany({ where: { organizationId } });
  await prisma.stockTransfer.deleteMany({ where: { organizationId } });
  await prisma.stockMovement.deleteMany({ where: { organizationId } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId } });
  await prisma.warehouse.deleteMany({ where: { organizationId } });
  await prisma.customer.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('a store with no delivery set up', () => {
  it('can’t be checked out', async () => {
    const config = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
    expect(config.deliveryAvailable).toBe(false);
    expect(await order('Lagos', 'Ikeja', 'rate_anything')).toMatchObject({ ok: false, code: 'invalid-delivery-method' });
  });
});

describe('delivery zones and options', () => {
  let phRateId = '';
  let restRateId = '';

  it('validates a zone and says which field is wrong', async () => {
    const result = await saveDeliveryZone(null, { warehouseId: mainId, name: 'X', kind: 'CITIES', state: null, cities: '' });
    expect(result.success).toBe(false);
    expect(!result.success && result.fieldErrors).toMatchObject({
      name: expect.any(String),
      state: 'Choose the state these cities are in',
      cities: 'Add at least one city or area',
    });
  });

  it('sets up a local city zone, a state zone and the rest of Nigeria', async () => {
    const ph = ok(await saveDeliveryZone(null, { warehouseId: mainId, name: 'Within Port Harcourt', kind: 'CITIES', state: 'Rivers', cities: 'Port Harcourt, Obio-Akpor' }));
    const south = ok(await saveDeliveryZone(null, { warehouseId: mainId, name: 'South-South', kind: 'STATES', states: ['Rivers', 'Bayelsa'] }));
    const rest = ok(await saveDeliveryZone(null, { warehouseId: mainId, name: 'Rest of Nigeria', kind: 'NATIONWIDE' }));

    phRateId = ok(await saveDeliveryRate(ph.id, null, { name: 'Local', price: 1500, minTime: 0, maxTime: 1, freeOver: 50000 })).id;
    ok(await saveDeliveryRate(south.id, null, { name: 'Standard', price: 3000, minTime: 2, maxTime: 3 }));
    restRateId = ok(await saveDeliveryRate(rest.id, null, { name: 'Standard', price: 5000, minTime: 3, maxTime: 7, freeOver: '' })).id;

    const settings = ok(await getDeliverySettings());
    expect(settings.zones.map((z) => [z.name, z.rates.map((r) => r.price)])).toEqual([
      ['Within Port Harcourt', [1500]],
      ['South-South', [3000]],
      ['Rest of Nigeria', [5000]],
    ]);
    expect((await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug })).deliveryAvailable).toBe(true);
  });

  it('refuses overlaps that would make matching ambiguous, naming the zone that has it', async () => {
    const city = await saveDeliveryZone(null, { warehouseId: mainId, name: 'PH again', kind: 'CITIES', state: 'Rivers', cities: 'port-harcourt' });
    expect(city).toMatchObject({ success: false, error: expect.stringContaining('Within Port Harcourt') });

    const state = await saveDeliveryZone(null, { warehouseId: mainId, name: 'Niger Delta', kind: 'STATES', states: ['Delta', 'Bayelsa'] });
    expect(state).toMatchObject({ success: false, error: expect.stringContaining('South-South') });

    const nationwide = await saveDeliveryZone(null, { warehouseId: mainId, name: 'Everywhere', kind: 'NATIONWIDE' });
    expect(nationwide).toMatchObject({ success: false, error: expect.stringContaining('Rest of Nigeria') });

    // The same city name in another state is a different place.
    const other = await saveDeliveryZone(null, { warehouseId: mainId, name: 'Lagos PH street', kind: 'CITIES', state: 'Lagos', cities: 'Port Harcourt' });
    expect(other.success).toBe(true);
    if (other.success) ok(await deleteDeliveryZone(other.data.id));
  });

  /* Not every merchant delivers in days: a supermarket promises 45 minutes,
   * a rider 2–3 hours. We keep the minutes AND the unit they typed in. */
  it('takes a delivery time in minutes or hours, and words it the same way', async () => {
    const settings = ok(await getDeliverySettings());
    const zoneId = settings.zones[0].id;
    const quick = ok(await saveDeliveryRate(zoneId, null, { name: 'Rider', price: 800, etaUnit: 'MINUTES', minTime: 30, maxTime: 45 }));

    const after = ok(await getDeliverySettings());
    const rate = after.zones[0].rates.find((r) => r.id === quick.id);
    expect(rate).toMatchObject({ etaUnit: 'MINUTES', minMinutes: 30, maxMinutes: 45 });

    const hours = ok(await saveDeliveryRate(zoneId, quick.id, { name: 'Rider', price: 800, etaUnit: 'HOURS', minTime: 2, maxTime: 3 }));
    const reread = ok(await getDeliverySettings()).zones[0].rates.find((r) => r.id === hours.id);
    expect(reread).toMatchObject({ etaUnit: 'HOURS', minMinutes: 120, maxMinutes: 180 });

    ok(await deleteDeliveryRate(quick.id));
  });

  it('holds each unit to its own ceiling', async () => {
    const zoneId = ok(await getDeliverySettings()).zones[0].id;
    const tooLong = await saveDeliveryRate(zoneId, null, { name: 'Slow', price: 100, etaUnit: 'MINUTES', minTime: 30, maxTime: 2000 });
    expect(tooLong).toMatchObject({ success: false, fieldErrors: { maxTime: expect.stringContaining('1440') } });
  });

  it('refuses a delivery window that ends before it starts', async () => {
    const settings = ok(await getDeliverySettings());
    const result = await saveDeliveryRate(settings.zones[0].id, null, { name: 'Odd', price: 100, minTime: 5, maxTime: 2 });
    expect(result).toMatchObject({ success: false, fieldErrors: { maxTime: expect.any(String) } });
  });

  it('shows the merchant exactly what a customer at an address would get', async () => {
    const ph = ok(await previewDelivery({ state: 'Rivers', city: 'port harcourt', subtotal: 10000 }));
    expect(ph.checkout).toEqual({
      storeName: 'Main',
      zoneName: 'Within Port Harcourt',
      options: [{ label: 'Local', detail: 'Delivery to Within Port Harcourt', price: 1500 }],
    });
    expect(ph.stores).toHaveLength(1);

    const free = ok(await previewDelivery({ state: 'Rivers', city: 'Port Harcourt', subtotal: 50000 }));
    expect(free.checkout.options[0].price).toBe(0);

    expect(ok(await previewDelivery({ state: 'Kano', city: 'Kano' })).checkout.zoneName).toBe('Rest of Nigeria');
  });

  it('charges the price quoted for the address — not a cheaper option from another zone', async () => {
    const local = await order('Rivers', 'Port Harcourt', `rate_${phRateId}`);
    expect(local.ok).toBe(true);
    if (local.ok) {
      const row = await prisma.order.findUniqueOrThrow({ where: { id: local.orderId } });
      expect(Number(row.deliveryFee)).toBe(1500);
      expect(row.deliveryMethodLabel).toBe('Local');
      expect(Number(row.totalAmount)).toBe(10000 + 1500);
    }

    // A Lagos shopper sending the Port Harcourt rate id doesn't get the local price.
    expect(await order('Lagos', 'Ikeja', `rate_${phRateId}`)).toMatchObject({ ok: false, code: 'invalid-delivery-method' });

    const far = await order('Lagos', 'Ikeja', `rate_${restRateId}`);
    expect(far.ok).toBe(true);
    if (far.ok) {
      expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: far.orderId } })).deliveryFee)).toBe(5000);
    }
  });

  it('makes delivery free on the order once the goods reach the threshold', async () => {
    const big = await order('Rivers', 'Obio-Akpor', `rate_${phRateId}`, 5); // ₦50,000
    expect(big.ok).toBe(true);
    if (big.ok) {
      expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: big.orderId } })).deliveryFee)).toBe(0);
      // The parcel says why it was free (Phase 9.4).
      expect(await prisma.orderShipment.findFirst({ where: { orderId: big.orderId }, select: { fee: true, freeOverApplied: true } })).toMatchObject({
        freeOverApplied: true,
      });
    }
  });
});

describe('pickup locations', () => {
  it('are offered and ordered from wherever the shopper lives', async () => {
    const pickup = ok(
      await savePickupLocation(null, {
        warehouseId: mainId,
        name: 'Main shop',
        address: '12 Aba Road',
        city: 'Port Harcourt',
        state: 'Rivers',
        instructions: 'Ask at the counter',
        readyTime: 1,
      }),
    );

    const preview = ok(await previewDelivery({ state: 'Kano', city: 'Kano' }));
    expect(preview.checkout.options.map((o) => o.label)).toContain('Pick up: Main shop');

    const result = await order('Kano', 'Kano', `pickup_${pickup.id}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
      expect(row.deliveryMethodLabel).toBe('Pick up: Main shop');
      expect(Number(row.deliveryFee)).toBe(0);
    }
  });

  it('validate their fields', async () => {
    const result = await savePickupLocation(null, { warehouseId: mainId, name: '', address: '', city: '', state: 'Atlantis' as never, readyTime: -1 });
    expect(result).toMatchObject({ success: false, fieldErrors: { name: expect.any(String), address: expect.any(String), state: expect.any(String) } });
  });
});

describe('the starting setup', () => {
  it('only runs for a store with no zones', async () => {
    expect(await createSuggestedDelivery(mainId)).toMatchObject({ success: false, error: expect.stringMatching(/already/i) });
  });

  it('refuses someone who can only view settings', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    try {
      expect(await saveDeliveryZone(null, { warehouseId: mainId, name: 'Sneaky', kind: 'STATES', states: ['Oyo'] })).toMatchObject({
        success: false,
        error: expect.stringMatching(/permission/i),
      });
      expect((await getDeliverySettings()).success).toBe(true);
    } finally {
      ctx.membership.role.permissions = [
        PERMISSIONS.SETTINGS_VIEW,
        PERMISSIONS.SETTINGS_EDIT,
        PERMISSIONS.SALES_VIEW,
        PERMISSIONS.SALES_FULFILLMENT_MANAGE,
        PERMISSIONS.INVENTORY_MOVEMENT_CREATE,
      ];
    }
  });
});

/*
 * ROADMAP Phase 9.2 — delivery belongs to the store a parcel leaves from.
 * Main (Port Harcourt) is set up above; Lagos joins here.
 */
describe('delivery per store', () => {
  let lagosId = '';
  let lagosOnlyItem = '';
  let mainRestRateId = '';
  let lagosToPhRateId = '';
  let otherOrgId = '';

  beforeAll(async () => {
    lagosId = (
      await prisma.warehouse.create({
        data: { organizationId: ctx.organization.id, name: 'Lagos', sellsOnline: true, status: 'ACTIVE', state: 'Lagos', city: 'Ikeja' },
      })
    ).id;
    lagosOnlyItem = (
      await prisma.inventoryItem.create({
        data: {
          organizationId: ctx.organization.id,
          name: 'Lagos lamp',
          sku: `LAMP-DEL-${suffix}`.slice(0, 40),
          slug: `lamp-del-${suffix}`.slice(0, 60),
          sellingPrice: 8000,
          isPublished: true,
          status: 'ACTIVE',
        },
      })
    ).id;
    await prisma.inventoryLevel.create({ data: { inventoryItemId: lagosOnlyItem, warehouseId: lagosId, quantity: 10 } });

    const settings = ok(await getDeliverySettings());
    const rest = settings.zones.find((z) => z.warehouseId === mainId && z.kind === 'NATIONWIDE')!;
    mainRestRateId = rest.rates[0].id;
  });

  afterAll(async () => {
    if (otherOrgId) {
      await prisma.warehouse.deleteMany({ where: { organizationId: otherOrgId } });
      await prisma.organization.delete({ where: { id: otherOrgId } });
    }
  });

  it('leaves out the stock of a store that sells online but can’t deliver, while another store can', async () => {
    const lagos = ok(await getDeliverySettings()).stores.find((s) => s.id === lagosId);
    expect(lagos).toMatchObject({ sellsOnline: true, hasLiveDelivery: false, suppliesOnline: false });

    // Only Lagos has the lamp, and Lagos can't send it anywhere yet.
    const refused = await order('Lagos', 'Ikeja', `rate_${mainRestRateId}`, 1, lagosOnlyItem);
    expect(refused.ok).toBe(false);
  });

  it('lets two stores cover the same place, refusing overlaps only within one store', async () => {
    const phFromLagos = ok(
      await saveDeliveryZone(null, { warehouseId: lagosId, name: 'Within Port Harcourt', kind: 'CITIES', state: 'Rivers', cities: 'Port Harcourt' }),
    );
    const restFromLagos = ok(await saveDeliveryZone(null, { warehouseId: lagosId, name: 'Rest of Nigeria', kind: 'NATIONWIDE' }));
    lagosToPhRateId = ok(await saveDeliveryRate(phFromLagos.id, null, { name: 'Interstate', price: 6000, minTime: 2, maxTime: 4 })).id;
    ok(await saveDeliveryRate(restFromLagos.id, null, { name: 'Standard', price: 2000, minTime: 2, maxTime: 5 }));

    const again = await saveDeliveryZone(null, { warehouseId: lagosId, name: 'Everywhere', kind: 'NATIONWIDE' });
    expect(again).toMatchObject({ success: false, error: expect.stringContaining('Rest of Nigeria') });

    const lagos = ok(await getDeliverySettings()).stores.find((s) => s.id === lagosId);
    expect(lagos).toMatchObject({ hasLiveDelivery: true, suppliesOnline: true });
  });

  it('refuses a store that belongs to another business', async () => {
    const other = await prisma.organization.create({ data: { name: 'Other', slug: `__test-delivery-other-${suffix}` } });
    otherOrgId = other.id;
    const theirs = await prisma.warehouse.create({ data: { organizationId: other.id, name: 'Theirs', sellsOnline: true } });

    expect(await saveDeliveryZone(null, { warehouseId: theirs.id, name: 'Sneaky', kind: 'NATIONWIDE' })).toMatchObject({
      success: false,
      fieldErrors: { warehouseId: expect.any(String) },
    });
    expect((await createSuggestedDelivery(theirs.id)).success).toBe(false);
    expect((await confirmStoreDelivery(theirs.id)).success).toBe(false);
    expect(await prisma.deliveryZone.count({ where: { warehouseId: theirs.id } })).toBe(0);
  });

  it('shows what each store would charge, and checkout sends from the cheapest store when every store has it', async () => {
    const ph = ok(await previewDelivery({ state: 'Rivers', city: 'Port Harcourt', subtotal: 10000 }));
    expect(ph.stores.map((s) => [s.storeName, s.options.filter((o) => !o.label.startsWith('Pick up')).map((o) => o.price)])).toEqual([
      ['Main', [1500]],
      ['Lagos', [6000]],
    ]);
    expect(ph.checkout.storeName).toBe('Main');
    // Kano: ₦2,000 from Lagos beats ₦5,000 from Main.
    expect(ok(await previewDelivery({ state: 'Kano', city: 'Kano' })).checkout.storeName).toBe('Lagos');
  });

  /* ROADMAP Phase 9.8 — the product page's "Ships from … · ₦… to …". */
  it('estimates one item for a place with checkout’s own planner — the store it leaves from and that store’s price', async () => {
    const ph = { state: 'Rivers', city: 'Port Harcourt' };
    expect(await estimateDelivery(ctx.organization.slug, { productId, variantId: productId }, ph)).toMatchObject({
      ok: true,
      estimate: { storeName: 'Main', cheapest: { label: 'Local', price: 150_000 } },
    });
    expect(await estimateDelivery(ctx.organization.slug, { productId: lagosOnlyItem, variantId: lagosOnlyItem }, ph)).toMatchObject({
      ok: true,
      estimate: { storeName: 'Lagos', cheapest: { label: 'Interstate', price: 600_000 } },
    });
    expect(
      await estimateDelivery(ctx.organization.slug, { productId: lagosOnlyItem, variantId: lagosOnlyItem }, { state: 'Kano', city: 'Kano' }),
    ).toMatchObject({ ok: true, estimate: { storeName: 'Lagos', cheapest: { price: 200_000 } } });
    expect(await estimateDelivery(ctx.organization.slug, { productId: 'nope', variantId: 'nope' }, ph)).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
    // Only a real Nigerian state is a place we quote for.
    expect(cleanDeliverTo({ state: 'Rivers State', city: 'PH' })).toBeNull();
    expect(cleanDeliverTo({ state: 'Lagos', city: '  Ikeja  ' })).toEqual({ state: 'Lagos', city: 'Ikeja' });
  });

  /* ROADMAP Phase 9.3 — the problem Phase 9 exists for. Main is in Port
   * Harcourt and holds the tote; only Lagos holds the lamp. */
  describe('a Port Harcourt shopper', () => {
    const rateOf = async (warehouseId: string, kind: 'CITIES' | 'NATIONWIDE') =>
      ok(await getDeliverySettings()).zones.find((z) => z.warehouseId === warehouseId && z.kind === kind)!.rates[0].id;
    const heldAt = async (orderId: string) =>
      (await prisma.orderStockAllocation.findMany({ where: { orderId }, select: { inventoryItemId: true, warehouseId: true } }))
        .map((a) => [a.inventoryItemId, a.warehouseId])
        .sort();

    it('buying what Port Harcourt holds pays the local price, sent from Port Harcourt', async () => {
      const result = await order('Rivers', 'Port Harcourt', `rate_${await rateOf(mainId, 'CITIES')}`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } })).deliveryFee)).toBe(1500);
      expect(await heldAt(result.orderId)).toEqual([[productId, mainId]]);
    });

    it('buying what only Lagos holds pays Lagos → Port Harcourt, sent from Lagos', async () => {
      // The local price is not on offer: the lamp isn't leaving Port Harcourt.
      expect(await order('Rivers', 'Port Harcourt', `rate_${await rateOf(mainId, 'CITIES')}`, 1, lagosOnlyItem)).toMatchObject({
        ok: false,
        code: 'invalid-delivery-method',
      });

      const result = await order('Rivers', 'Port Harcourt', `rate_${lagosToPhRateId}`, 1, lagosOnlyItem);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } })).deliveryFee)).toBe(6000);
      expect(await heldAt(result.orderId)).toEqual([[lagosOnlyItem, lagosId]]);
    });

    let mixedOrderId = '';

    it('with a mixed bag pays both trips, and each part is held where it leaves from', async () => {
      const config = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
      const result = await placeOrder({
        organizationSlug: ctx.organization.slug,
        customerId: null,
        lines: [
          { productId, variantId: productId, quantity: 1 },
          { productId: lagosOnlyItem, variantId: lagosOnlyItem, quantity: 1 },
        ],
        contact: { firstName: 'Ada', lastName: 'Okoro', email: `ada-del-${suffix}@example.com`, phone: '08012345678' },
        address: ADDRESS('Rivers', 'Port Harcourt'),
        // One choice per parcel (Phase 9.5), biggest parcel first: the tote from Main, the lamp from Lagos.
        deliveryMethodId: `rate_${await rateOf(mainId, 'CITIES')}+rate_${lagosToPhRateId}`,
        paymentMethodId: 'pod',
        note: '',
        config,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      mixedOrderId = result.orderId;
      const row = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
      expect(Number(row.deliveryFee)).toBe(1500 + 6000);
      expect(row.deliveryMethodLabel).toBe('Local + Interstate · 2 parcels');
      expect(await heldAt(result.orderId)).toEqual([[productId, mainId], [lagosOnlyItem, lagosId]].sort());

      // One parcel per store (Phase 9.4), each with its own option and fee, holding its own stock.
      const shipments = await prisma.orderShipment.findMany({
        where: { orderId: result.orderId },
        orderBy: { sortOrder: 'asc' },
        include: { allocations: { select: { inventoryItemId: true } } },
      });
      expect(
        shipments.map((sh) => [sh.warehouseId, sh.deliveryMethodLabel, Number(sh.fee), sh.allocations.map((a) => a.inventoryItemId)]),
      ).toEqual([
        [mainId, 'Local', 1500, [productId]],
        [lagosId, 'Interstate', 6000, [lagosOnlyItem]],
      ]);
      // The order's fee is the parcels' sum.
      expect(shipments.reduce((sum, sh) => sum + Number(sh.fee), 0)).toBe(Number(row.deliveryFee));
    });

    /* ROADMAP Phase 9.6 — each store sends its own parcel. */
    describe('sent parcel by parcel', () => {
      const parcelAt = async (warehouseId: string) =>
        (await prisma.orderShipment.findFirstOrThrow({ where: { orderId: mixedOrderId, warehouseId }, select: { id: true } })).id;
      const asStores = async <T,>(warehouseIds: string[], run: () => Promise<T>) => {
        ctx.membership.warehouseIds = warehouseIds;
        try {
          return await run();
        } finally {
          ctx.membership.warehouseIds = [];
        }
      };

      it('shows each parcel with what its courier collects, adding up to the order total', async () => {
        expect(await confirmOrder({ organizationId: ctx.organization.id, orderId: mixedOrderId })).toEqual({ ok: true });
        const detail = ok(await getStoreOrder(mixedOrderId));
        expect(detail.parcels.map((p) => [p.storeName, p.label, p.fee, p.toCollect, p.items.map((i) => i.name)])).toEqual([
          ['Main', 'Local', 1500, 10000 + 1500, ['Tote']],
          ['Lagos', 'Interstate', 6000, 8000 + 6000, ['Lagos lamp']],
        ]);
        expect(detail.parcels.reduce((sum, p) => sum + (p.toCollect ?? 0), 0)).toBe(detail.totalAmount);
      });

      it('lets a Lagos-only member send only the Lagos parcel', async () => {
        const main = await parcelAt(mainId);
        await asStores([lagosId], async () => {
          expect(ok(await getStoreOrder(mixedOrderId)).parcels.map((p) => p.canWorkHere)).toEqual([false, true]);
          expect((await updateStoreShipment(mixedOrderId, main, 'send')).success).toBe(false);
          // "Send all" would take Main's stock too.
          expect((await updateStoreOrder(mixedOrderId, 'ship')).success).toBe(false);
          ok(await updateStoreShipment(mixedOrderId, await parcelAt(lagosId), 'send', { trackingNote: 'GIG, waybill 42' }));
        });

        const detail = ok(await getStoreOrder(mixedOrderId));
        expect(detail.status).toBe('PROCESSING');
        expect(detail.partiallySent).toBe(true);
        expect(detail.parcels.map((p) => p.status)).toEqual(['PENDING', 'DISPATCHED']);
        expect(detail.parcels[1].trackingNote).toBe('GIG, waybill 42');
        // Only Lagos's stock left the shelf.
        const holds = await prisma.orderStockAllocation.findMany({ where: { orderId: mixedOrderId }, select: { warehouseId: true, status: true } });
        expect(holds.map((h) => [h.warehouseId, h.status]).sort()).toEqual([[lagosId, 'DISPATCHED'], [mainId, 'RESERVED']].sort());
      });

      it('can’t be cancelled once a parcel has left', async () => {
        const result = await updateStoreOrder(mixedOrderId, 'cancel');
        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/already been sent/) });
      });

      it('is shipped when the last parcel leaves, and delivered — and paid — when the last one arrives', async () => {
        ok(await updateStoreShipment(mixedOrderId, await parcelAt(mainId), 'send'));
        let detail = ok(await getStoreOrder(mixedOrderId));
        expect(detail.status).toBe('SHIPPED');
        expect(detail.partiallySent).toBe(false);

        ok(await updateStoreShipment(mixedOrderId, await parcelAt(lagosId), 'deliver'));
        expect(ok(await getStoreOrder(mixedOrderId)).status).toBe('SHIPPED');

        ok(await updateStoreShipment(mixedOrderId, await parcelAt(mainId), 'deliver', { paymentCollected: true }));
        detail = ok(await getStoreOrder(mixedOrderId));
        expect(detail).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
        expect(detail.parcels.map((p) => p.status)).toEqual(['DELIVERED', 'DELIVERED']);
      });
    });

  });

  it('sells the other store’s stock once it can deliver, from that store', async () => {
    const lagosRest = ok(await getDeliverySettings()).zones.find((z) => z.warehouseId === lagosId && z.kind === 'NATIONWIDE')!;
    const result = await order('Kano', 'Kano', `rate_${lagosRest.rates[0].id}`, 1, lagosOnlyItem);
    expect(result.ok).toBe(true);
  });

  it('asks for copied prices to be checked, until someone confirms them', async () => {
    await prisma.warehouse.update({ where: { id: lagosId }, data: { deliveryNeedsReview: true } });
    expect(ok(await getDeliverySettings()).stores.find((s) => s.id === lagosId)?.needsReview).toBe(true);

    ok(await confirmStoreDelivery(lagosId));
    expect(ok(await getDeliverySettings()).stores.find((s) => s.id === lagosId)?.needsReview).toBe(false);
  });

  it('gives each store its own starting setup', async () => {
    const abuja = await prisma.warehouse.create({
      data: { organizationId: ctx.organization.id, name: 'Abuja', sellsOnline: true, status: 'ACTIVE' },
    });
    ok(await createSuggestedDelivery(abuja.id));
    expect(await prisma.deliveryZone.count({ where: { warehouseId: abuja.id, kind: 'NATIONWIDE' } })).toBe(1);
    expect((await createSuggestedDelivery(abuja.id)).success).toBe(false);
  });

  /* ROADMAP Phase 9.7 — the merchant brings a split bag together at one store. */
  describe('brought together at one store', () => {
    let tote = '';
    let lamp = '';

    const make = async (name: string, warehouseId: string) => {
      const id = (
        await prisma.inventoryItem.create({
          data: {
            organizationId: ctx.organization.id,
            name,
            sku: `${name}-${suffix}`.slice(0, 40),
            slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}`.slice(0, 60),
            sellingPrice: 5000,
            isPublished: true,
            status: 'ACTIVE',
          },
        })
      ).id;
      await prisma.inventoryLevel.create({ data: { inventoryItemId: id, warehouseId, quantity: 5 } });
      return id;
    };
    const place = async () => {
      const lines = [
        { productId: tote, variantId: tote, quantity: 1 },
        { productId: lamp, variantId: lamp, quantity: 1 },
      ];
      const config = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
      return placeOrder({
        organizationSlug: ctx.organization.slug,
        customerId: null,
        lines,
        contact: { firstName: 'Ada', lastName: 'Okoro', email: `ada-del-${suffix}@example.com`, phone: '08012345678' },
        address: ADDRESS('Rivers', 'Port Harcourt'),
        deliveryMethodId: await quotedDeliveryId(ctx.organization.slug, { state: 'Rivers', city: 'Port Harcourt' }, lines),
        paymentMethodId: 'pod',
        note: '',
        config,
      });
    };
    const level = (itemId: string, warehouseId: string) =>
      prisma.inventoryLevel.findUniqueOrThrow({
        where: { inventoryItemId_warehouseId: { inventoryItemId: itemId, warehouseId } },
        select: { quantity: true, reservedQty: true },
      });

    beforeAll(async () => {
      tote = await make('Gather Tote', mainId);
      lamp = await make('Gather Lamp', lagosId);
      ok(await saveConsolidationPolicy({ enabled: true, fee: 1000, leadTime: 2, leadUnit: 'DAYS' }));
    });

    afterAll(async () => {
      await saveConsolidationPolicy({ enabled: false, fee: 0, leadTime: 1, leadUnit: 'DAYS' });
    });

    it('sends one parcel from Port Harcourt, holding the lamp in Lagos until it’s sent over', async () => {
      const placed = await place();
      if (!placed.ok) throw new Error(placed.message);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
      // Port Harcourt's local ₦1,500 plus ₦1,000 for bringing the lamp from Lagos.
      expect(Number(order.deliveryFee)).toBe(1500 + 1000);
      expect(order.deliveryMethodLabel).toBe('Local · brought together');

      const shipments = await prisma.orderShipment.findMany({ where: { orderId: placed.orderId } });
      expect(shipments.map((sh) => sh.warehouseId)).toEqual([mainId]);
      const holds = await prisma.orderStockAllocation.findMany({ where: { orderId: placed.orderId } });
      expect(holds.map((h) => [h.inventoryItemId, h.warehouseId, h.status, h.shipmentId]).sort()).toEqual(
        [
          [tote, mainId, 'RESERVED', shipments[0].id],
          [lamp, lagosId, 'RESERVED', shipments[0].id],
        ].sort(),
      );
      // Nothing is asked of Lagos until the order is confirmed.
      expect(await prisma.stockTransfer.count({ where: { orderId: placed.orderId } })).toBe(0);

      expect(await confirmOrder({ organizationId: ctx.organization.id, orderId: placed.orderId })).toEqual({ ok: true });
      const [transfer] = await prisma.stockTransfer.findMany({ where: { orderId: placed.orderId } });
      expect(transfer).toMatchObject({ status: 'REQUESTED', fromWarehouseId: lagosId, toWarehouseId: mainId, inventoryItemId: lamp });

      // Port Harcourt can't send the parcel yet.
      expect(await updateStoreOrder(placed.orderId, 'ship')).toMatchObject({ success: false, error: expect.stringMatching(/waiting for items from Lagos/) });
      expect(ok(await getStoreOrder(placed.orderId)).parcels[0].broughtFrom).toEqual([
        { storeName: 'Lagos', itemName: 'Gather Lamp', quantity: 1, status: 'REQUESTED' },
      ]);

      // Lagos sends it: its hold goes, and so does the lamp.
      ok(await sendOrderTransfer(transfer.id));
      expect(Number((await level(lamp, lagosId)).quantity)).toBe(4);
      expect(Number((await level(lamp, lagosId)).reservedQty)).toBe(0);

      // Port Harcourt receives it, and it's held for the order there at once.
      ok(await receiveTransfer(transfer.id));
      const atMain = await level(lamp, mainId);
      expect([Number(atMain.quantity), Number(atMain.reservedQty)]).toEqual([1, 1]);

      // Now the one parcel goes, with everything in it, from Port Harcourt.
      ok(await updateStoreOrder(placed.orderId, 'ship'));
      const sent = await prisma.orderStockAllocation.findMany({ where: { orderId: placed.orderId, status: 'DISPATCHED' } });
      expect(sent.map((a) => [a.inventoryItemId, a.warehouseId]).sort()).toEqual([[tote, mainId], [lamp, mainId]].sort());
      expect(Number((await level(lamp, mainId)).quantity)).toBe(0);
      // The whole journey — place, confirm, send over, receive, ship — against a remote database.
    }, 60_000);

    it('cancels a transfer nobody has sent when the order is cancelled', async () => {
      const placed = await place();
      if (!placed.ok) throw new Error(placed.message);
      await confirmOrder({ organizationId: ctx.organization.id, orderId: placed.orderId });
      ok(await updateStoreOrder(placed.orderId, 'cancel'));
      expect(await prisma.stockTransfer.findFirst({ where: { orderId: placed.orderId }, select: { status: true } })).toEqual({
        status: 'CANCELLED',
      });
      expect(Number((await level(lamp, lagosId)).reservedQty)).toBe(0);
    });
  });
});
