/*
 * The merchant's checkout rules (Settings → Payments → Checkout), against the
 * real database: what checkout offers, what placing an order accepts, and
 * who may change them. The rules are enforced where the order is written, so
 * a checkout page left open from before a change can't get round them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { giveStoreDelivery } from './helpers/delivery';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';

const ctx = vi.hoisted(() => ({
  organization: { id: '', name: 'Checkout Rules', slug: '', logoUrl: null, plan: 'PRO', status: 'ACTIVE' },
  membership: { id: 'm', role: { id: 'r', name: 'Owner', isSystem: true, permissions: [] as string[] } },
  userId: null as unknown as string,
}));

vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

const { saveCheckoutRules } = await import('@/features/settings/checkout-rules');
const { getStoreCheckoutConfig } = await import('@/lib/storefront/checkout/store-config');
const { placeOrder } = await import('@/lib/storefront/orders/create');
const { registerShopper } = await import('@/lib/storefront/account/shopper');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-checkout-rules-${suffix}` };
const other = { id: '', slug: `__test-checkout-rules-other-${suffix}` };

let customerId = '';
let productId = '';
let deliveryMethodId = '';

// Real orders against real products: the catalogue must read the database.
const fixturesWere = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const CONTACT: CheckoutContact = { firstName: 'Ada', lastName: 'Okoro', email: `ada-${suffix}@example.com`, phone: '08012345678' };
const ADDRESS: CheckoutAddress = {
  firstName: 'Ada',
  lastName: 'Okoro',
  phone: '08012345678',
  country: 'NG',
  state: 'Rivers',
  city: 'Port Harcourt',
  addressLine1: '12 Example Street',
  addressLine2: '',
  postalCode: '',
};

const rulesOn = { payOnDelivery: true, guestAllowed: true, orderNotes: true };

async function setRules(organizationId: string, rules: Partial<typeof rulesOn>) {
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      checkoutPayOnDelivery: rules.payOnDelivery ?? true,
      checkoutGuestAllowed: rules.guestAllowed ?? true,
      checkoutOrderNotes: rules.orderNotes ?? true,
    },
  });
}

async function order(input: { customerId?: string | null; paymentMethodId?: string; note?: string; contact?: CheckoutContact }) {
  const config = await getStoreCheckoutConfig({ organizationSlug: store.slug });
  return placeOrder({
    organizationSlug: store.slug,
    customerId: input.customerId ?? null,
    lines: [{ productId, variantId: productId, quantity: 1 }],
    contact: input.contact ?? CONTACT,
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId: input.paymentMethodId ?? 'pod',
    note: input.note ?? '',
    config,
  });
}

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Checkout Rules', slug: store.slug } })).id;
  other.id = (await prisma.organization.create({ data: { name: 'Other', slug: other.slug } })).id;
  ctx.organization.id = store.id;
  ctx.organization.slug = store.slug;
  ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];

  const shopper = await registerShopper({ organizationId: store.id, name: 'Ada Okoro', email: CONTACT.email, password: 'a password here' });
  if (!shopper.ok) throw new Error('setup failed');
  customerId = shopper.customer.id;

  const warehouse = await prisma.warehouse.create({
    data: { organizationId: store.id, name: 'Rules Store', sellsOnline: true, status: 'ACTIVE' },
  });
  productId = (
    await prisma.inventoryItem.create({
      data: {
        organizationId: store.id,
        name: 'Tote',
        sku: `tote-${suffix}`.slice(0, 40),
        slug: `tote-${suffix}`.slice(0, 60),
        sellingPrice: 5000,
        isPublished: true,
        status: 'ACTIVE',
      },
      select: { id: true },
    })
  ).id;
  await prisma.inventoryLevel.create({ data: { inventoryItemId: productId, warehouseId: warehouse.id, quantity: 100 } });
  deliveryMethodId = await giveStoreDelivery(store.id);
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;

  for (const org of [store, other]) {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: org.id } } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.stockMovement.deleteMany({ where: { organizationId: org.id } });
    await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: org.id } } });
    await prisma.inventoryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.merchantBankAccount.deleteMany({ where: { organizationId: org.id } });
    await prisma.warehouse.deleteMany({ where: { organizationId: org.id } });
    await prisma.customer.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

describe('what checkout offers', () => {
  it('offers everything by default, as every shop worked before', async () => {
    await setRules(store.id, rulesOn);
    const config = await getStoreCheckoutConfig({ organizationSlug: store.slug });
    expect(config.paymentMethods.map((m) => m.id)).toContain('pod');
    expect(config.guestCheckoutEnabled).toBe(true);
    expect(config.orderNotesEnabled).toBe(true);
  });

  it('follows the merchant’s rules, and only for their own shop', async () => {
    await setRules(store.id, { payOnDelivery: false, guestAllowed: false, orderNotes: false });
    const config = await getStoreCheckoutConfig({ organizationSlug: store.slug });
    expect(config.paymentMethods.map((m) => m.id)).not.toContain('pod');
    expect(config.guestCheckoutEnabled).toBe(false);
    expect(config.orderNotesEnabled).toBe(false);

    const theirs = await getStoreCheckoutConfig({ organizationSlug: other.slug });
    expect(theirs.paymentMethods.map((m) => m.id)).toContain('pod');
    expect(theirs.guestCheckoutEnabled).toBe(true);
    expect(theirs.orderNotesEnabled).toBe(true);
  });
});

describe('placing an order', () => {
  it('refuses pay on delivery once the shop has turned it off', async () => {
    await setRules(store.id, { payOnDelivery: false });
    const result = await order({ customerId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid-payment-method');

    await setRules(store.id, rulesOn);
    expect((await order({ customerId })).ok).toBe(true);
  });

  it('refuses a guest when the shop needs an account, without making a customer record', async () => {
    await setRules(store.id, { guestAllowed: false });
    const email = `guest-${suffix}@example.com`;
    const result = await order({ contact: { ...CONTACT, email } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('sign-in-required');
    expect(await prisma.customer.count({ where: { organizationId: store.id, email } })).toBe(0);

    // A session naming an account that isn't this shop's is no account here.
    const stale = await order({ customerId: 'not-a-customer', contact: { ...CONTACT, email } });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('sign-in-required');
    expect(await prisma.customer.count({ where: { organizationId: store.id, email } })).toBe(0);

    // A signed-in shopper orders as before.
    expect((await order({ customerId })).ok).toBe(true);
  });

  it('keeps no note when the shop has turned notes off, whatever the browser sent', async () => {
    await setRules(store.id, { orderNotes: false });
    const off = await order({ customerId, note: 'Call before you come' });
    if (!off.ok) throw new Error(off.message);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: off.orderId } })).note).toBeNull();

    await setRules(store.id, rulesOn);
    const on = await order({ customerId, note: 'Call before you come' });
    if (!on.ok) throw new Error(on.message);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: on.orderId } })).note).toBe('Call before you come');
  });
});

describe('changing the rules', () => {
  it('won’t turn off pay on delivery while it is the only way to pay', async () => {
    await setRules(store.id, rulesOn);
    const result = await saveCheckoutRules({ ...rulesOn, payOnDelivery: false });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/only way shoppers can pay/);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: store.id } })).checkoutPayOnDelivery).toBe(true);
  });

  it('turns it off once a bank account is taking transfers, and records who did', async () => {
    await prisma.merchantBankAccount.create({
      data: { organizationId: store.id, bankName: 'Test Bank', accountName: 'Rules Ltd', accountNumber: '0123456789' },
    });
    const result = await saveCheckoutRules({ payOnDelivery: false, guestAllowed: false, orderNotes: true });
    expect(result.success).toBe(true);

    const saved = await prisma.organization.findUniqueOrThrow({ where: { id: store.id } });
    expect(saved.checkoutPayOnDelivery).toBe(false);
    expect(saved.checkoutGuestAllowed).toBe(false);
    expect(saved.checkoutOrderNotes).toBe(true);
    expect(await prisma.auditLog.count({ where: { organizationId: store.id, action: 'settings.checkout.updated' } })).toBe(1);

    // Another shop is untouched.
    const theirs = await prisma.organization.findUniqueOrThrow({ where: { id: other.id } });
    expect(theirs.checkoutPayOnDelivery).toBe(true);
    expect(theirs.checkoutGuestAllowed).toBe(true);
  });

  it('needs permission to change payment settings', async () => {
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW];
    const result = await saveCheckoutRules(rulesOn);
    ctx.membership.role.permissions = [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT];
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/permission/);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: store.id } })).checkoutPayOnDelivery).toBe(false);
  });
});
