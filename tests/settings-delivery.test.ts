// Merchant delivery settings, and orders priced from them — real DB, mocked org context.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Delivery Test', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
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
} = await import('@/features/settings/delivery');
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { placeOrder } = await import('@/lib/storefront/orders/create');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let productId = '';

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

async function order(state: string, city: string, deliveryMethodId: string, quantity = 1) {
  const config = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
  return placeOrder({
    organizationSlug: ctx.organization.slug,
    customerId: null,
    lines: [{ productId, variantId: productId, quantity }],
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
  ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];

  const warehouse = await prisma.warehouse.create({
    data: { organizationId: org.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' },
  });
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
    const result = await saveDeliveryZone(null, { name: 'X', kind: 'CITIES', state: null, cities: '' });
    expect(result.success).toBe(false);
    expect(!result.success && result.fieldErrors).toMatchObject({
      name: expect.any(String),
      state: 'Choose the state these cities are in',
      cities: 'Add at least one city or area',
    });
  });

  it('sets up a local city zone, a state zone and the rest of Nigeria', async () => {
    const ph = ok(await saveDeliveryZone(null, { name: 'Within Port Harcourt', kind: 'CITIES', state: 'Rivers', cities: 'Port Harcourt, Obio-Akpor' }));
    const south = ok(await saveDeliveryZone(null, { name: 'South-South', kind: 'STATES', states: ['Rivers', 'Bayelsa'] }));
    const rest = ok(await saveDeliveryZone(null, { name: 'Rest of Nigeria', kind: 'NATIONWIDE' }));

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
    const city = await saveDeliveryZone(null, { name: 'PH again', kind: 'CITIES', state: 'Rivers', cities: 'port-harcourt' });
    expect(city).toMatchObject({ success: false, error: expect.stringContaining('Within Port Harcourt') });

    const state = await saveDeliveryZone(null, { name: 'Niger Delta', kind: 'STATES', states: ['Delta', 'Bayelsa'] });
    expect(state).toMatchObject({ success: false, error: expect.stringContaining('South-South') });

    const nationwide = await saveDeliveryZone(null, { name: 'Everywhere', kind: 'NATIONWIDE' });
    expect(nationwide).toMatchObject({ success: false, error: expect.stringContaining('Rest of Nigeria') });

    // The same city name in another state is a different place.
    const other = await saveDeliveryZone(null, { name: 'Lagos PH street', kind: 'CITIES', state: 'Lagos', cities: 'Port Harcourt' });
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
    expect(ph).toEqual({ zoneName: 'Within Port Harcourt', options: [{ label: 'Local', detail: 'Delivery to Within Port Harcourt', price: 1500 }] });

    const free = ok(await previewDelivery({ state: 'Rivers', city: 'Port Harcourt', subtotal: 50000 }));
    expect(free.options[0].price).toBe(0);

    expect(ok(await previewDelivery({ state: 'Kano', city: 'Kano' })).zoneName).toBe('Rest of Nigeria');
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
    }
  });
});

describe('pickup locations', () => {
  it('are offered and ordered from wherever the shopper lives', async () => {
    const pickup = ok(
      await savePickupLocation(null, {
        name: 'Main shop',
        address: '12 Aba Road',
        city: 'Port Harcourt',
        state: 'Rivers',
        instructions: 'Ask at the counter',
        readyTime: 1,
      }),
    );

    const preview = ok(await previewDelivery({ state: 'Kano', city: 'Kano' }));
    expect(preview.options.map((o) => o.label)).toContain('Pick up: Main shop');

    const result = await order('Kano', 'Kano', `pickup_${pickup.id}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
      expect(row.deliveryMethodLabel).toBe('Pick up: Main shop');
      expect(Number(row.deliveryFee)).toBe(0);
    }
  });

  it('validate their fields', async () => {
    const result = await savePickupLocation(null, { name: '', address: '', city: '', state: 'Atlantis' as never, readyTime: -1 });
    expect(result).toMatchObject({ success: false, fieldErrors: { name: expect.any(String), address: expect.any(String), state: expect.any(String) } });
  });
});

describe('the starting setup', () => {
  it('only runs for a store with no zones', async () => {
    expect(await createSuggestedDelivery()).toMatchObject({ success: false, error: expect.stringMatching(/already/i) });
  });

  it('refuses someone who can only view settings', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    try {
      expect(await saveDeliveryZone(null, { name: 'Sneaky', kind: 'STATES', states: ['Oyo'] })).toMatchObject({
        success: false,
        error: expect.stringMatching(/permission/i),
      });
      expect((await getDeliverySettings()).success).toBe(true);
    } finally {
      ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];
    }
  });
});
