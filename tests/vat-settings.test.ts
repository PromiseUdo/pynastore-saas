/*
 * VAT settings (ROADMAP 14.1), against the real database: a shop is not VAT
 * registered until its merchant says so, and then checkout states the VAT
 * inside its prices; a change applies to orders from then on, never to ones
 * already placed; and the rate is checked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
}));
const ctx = vi.hoisted(() => ({
  userId: 'user-vat',
  organization: { id: '', slug: '' },
  membership: { role: { name: 'Owner', isSystem: true, permissions: ['settings.view', 'settings.edit'] } },
}));
vi.mock('@/lib/organization', () => ({ getOrganizationContext: async () => ctx }));

import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { placeOrder } from '@/lib/storefront/orders/create';
import { getOrganizationSettings, saveOrganizationSettings } from '@/features/settings/organization';

const fixturesWas = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let productId = '';
let deliveryMethodId = '';

const save = (vat: { vatRegistered: boolean; vatRate?: number; vatNumber?: string }) =>
  saveOrganizationSettings({ name: 'VAT Store', supportEmail: '', supportPhone: '', businessAddress: '', socialLinks: {}, ...vat });

async function order() {
  const config = await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug });
  const result = await placeOrder({
    organizationSlug: ctx.organization.slug,
    customerId: null,
    lines: [{ productId, variantId: productId, quantity: 1 }],
    contact: { firstName: 'Ada', lastName: 'Okoro', email: `ada-vat-${suffix}@example.com`, phone: '08012345678' },
    address: { firstName: 'Ada', lastName: 'Okoro', phone: '08012345678', country: 'NG', state: 'Lagos', city: 'Ikeja', addressLine1: '1 Allen Avenue', addressLine2: '', postalCode: '' },
    deliveryMethodId,
    paymentMethodId: 'pod',
    note: '',
    config,
  });
  if (!result.ok) throw new Error(result.message);
  return prisma.order.findUniqueOrThrow({ where: { id: result.orderId }, select: { id: true, subtotal: true, taxAmount: true, totalAmount: true, deliveryFee: true, vatNumber: true } });
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: 'VAT Store', slug: `__test-vat-${suffix}` } });
  ctx.organization = { id: org.id, slug: org.slug };
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' } });
  deliveryMethodId = await giveStoreDelivery(org.id);
  const item = await prisma.inventoryItem.create({
    data: { organizationId: org.id, name: 'Kaftan', sku: `VAT-${suffix}`.slice(0, 40), slug: `vat-${suffix}`.slice(0, 60), sellingPrice: 10_750, isPublished: true, status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 50 } });
  productId = item.id;
});

afterAll(async () => {
  if (fixturesWas === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWas;
  const organizationId = ctx.organization.id;
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId } } });
  await prisma.order.deleteMany({ where: { organizationId } });
  await prisma.stockMovement.deleteMany({ where: { organizationId } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId } });
  await prisma.warehouse.deleteMany({ where: { organizationId } });
  await prisma.customer.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe('VAT settings', () => {
  it('starts off: no VAT in checkout or on orders', async () => {
    await expect(getOrganizationSettings()).resolves.toMatchObject({ success: true, data: { vatRegistered: false, vatRate: 7.5, vatNumber: null } });
    expect((await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug })).vat).toBeNull();
    const row = await order();
    expect(Number(row.taxAmount)).toBe(0);
    expect(row.vatNumber).toBeNull();
  });

  it('once registered, states the VAT inside the price — the total doesn’t change — and keeps placed orders as they were', async () => {
    const before = await order();
    await expect(save({ vatRegistered: true, vatRate: 7.5, vatNumber: ' VAT-998877 ' })).resolves.toMatchObject({ success: true });
    expect((await getStoreCheckoutConfig({ organizationSlug: ctx.organization.slug })).vat).toEqual({ ratePct: 7.5, vatNumber: 'VAT-998877' });

    const after = await order();
    expect(Number(after.subtotal)).toBe(10_750);
    expect(Number(after.taxAmount)).toBe(750);
    expect(Number(after.totalAmount)).toBe(Number(before.totalAmount));
    expect(after.vatNumber).toBe('VAT-998877');

    // Turned off again: new orders have none, the one placed while on keeps its VAT.
    await save({ vatRegistered: false });
    expect(Number((await order()).taxAmount)).toBe(0);
    const kept = await prisma.order.findUniqueOrThrow({ where: { id: after.id } });
    expect(Number(kept.taxAmount)).toBe(750);
    expect(kept.vatNumber).toBe('VAT-998877');
    // The rate is kept for next time.
    await expect(getOrganizationSettings()).resolves.toMatchObject({ data: { vatRegistered: false, vatRate: 7.5 } });
  });

  it('checks the rate', async () => {
    await expect(save({ vatRegistered: true, vatRate: 0 })).resolves.toMatchObject({ success: false, fieldErrors: { vatRate: expect.any(String) } });
    await expect(save({ vatRegistered: true, vatRate: 80 })).resolves.toMatchObject({ success: false, fieldErrors: { vatRate: expect.any(String) } });
    await expect(save({ vatRegistered: true, vatRate: Number.NaN })).resolves.toMatchObject({ success: false, fieldErrors: { vatRate: expect.any(String) } });
  });
});
