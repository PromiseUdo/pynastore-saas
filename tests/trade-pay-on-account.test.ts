/*
 * Pay on account (ROADMAP 21.5), against the real database: only a trade
 * buyer the merchant has given credit may order on account, within their
 * limit and with nothing overdue; the order is confirmed at once and due by
 * their terms; payments are recorded until it's paid; reminders go once
 * each; and their balance counts unpaid invoices too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { givePlan, dropBilling } from './helpers/plans';
import type { CheckoutAddress } from '@/lib/storefront/checkout/types';

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
const { recordAccountPayment, remindAccountOrders } = await import('@/lib/storefront/orders/account');
const { accountBalance } = await import('@/lib/trade/credit');
const { paymentAllowsSending } = await import('@/lib/storefront/orders/policy');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-trade-account-${suffix}` };
const people = { credit: '', noCredit: '', shopper: '' };
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
  store.id = (await prisma.organization.create({ data: { name: 'Credit Shop', slug: store.slug, wholesaleMode: 'RETAIL_AND_TRADE', tradeAccountDays: 14 } })).id;
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
        isPublished: true,
        status: 'ACTIVE',
      },
    })
  ).id;
  await prisma.inventoryLevel.create({ data: { inventoryItemId: riceId, warehouseId: warehouse.id, quantity: 10_000 } });
  deliveryMethodId = await giveStoreDelivery(store.id);

  for (const key of Object.keys(people) as (keyof typeof people)[]) {
    const made = await registerShopper({ organizationId: store.id, name: `${key} buyer`, email: `${key}-${suffix}@example.com`, password: 'a password here' });
    if (!made.ok) throw new Error('setup failed');
    people[key] = made.customer.id;
  }
  // Credit: 30 days, up to ₦100,000 owed at once.
  await prisma.tradeAccount.create({
    data: { organizationId: store.id, customerId: people.credit, status: 'APPROVED', businessName: 'Credit Stores', onAccount: true, accountDays: 30, creditLimit: 100_000 },
  });
  await prisma.tradeAccount.create({ data: { organizationId: store.id, customerId: people.noCredit, status: 'APPROVED', businessName: 'Cash Stores' } });
});

afterAll(async () => {
  if (fixturesWere === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWere;
  await prisma.orderAccountPayment.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderStockAllocation.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.orderShipment.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.invoice.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.tradeAccount.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.deliveryRate.deleteMany({ where: { organizationId: store.id } });
  await prisma.deliveryZone.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.auditLog.deleteMany({ where: { organizationId: store.id } });
  await dropBilling(store.id);
  await prisma.organization.delete({ where: { id: store.id } });
});

beforeEach(() => {
  session.shopper = null;
});

const isTrade = (id: string) => id !== people.shopper;
const configFor = (customerId: string) =>
  getStoreCheckoutConfig({ organizationSlug: store.slug }, { tradeBuyer: isTrade(customerId), customerId });

async function order(customerId: string, quantity: number, paymentMethodId = 'account') {
  session.shopper = { id: customerId, organizationId: store.id };
  return placeOrder({
    organizationSlug: store.slug,
    customerId,
    lines: [{ productId: riceId, variantId: riceId, quantity }],
    contact: { firstName: 'Bola', lastName: 'Ade', email: `${Object.entries(people).find(([, v]) => v === customerId)![0]}-${suffix}@example.com`, phone: '08012345678' },
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId,
    note: '',
    discountCode: null,
    config: await configFor(customerId),
  });
}

const row = (id: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id },
    select: { status: true, paymentStatus: true, totalAmount: true, accountDueAt: true, accountPaidAmount: true, paidAt: true, accountReminders: true },
  });

describe('who may pay on account', () => {
  it('is offered only to a wholesaler given credit', async () => {
    const credit = await configFor(people.credit);
    expect(credit.paymentMethods.map((m) => m.id)).toContain('account');
    expect(credit.tradeAccount).toMatchObject({ days: 30, creditLimit: 10_000_000, owed: 0, overdue: 0 });
    expect((await configFor(people.noCredit)).paymentMethods.map((m) => m.id)).not.toContain('account');
    expect((await configFor(people.shopper)).paymentMethods.map((m) => m.id)).not.toContain('account');
    // Asking for it anyway is refused.
    expect(await order(people.noCredit, 1)).toMatchObject({ ok: false, code: 'invalid-payment-method' });
  });
});

describe('an order on account', () => {
  let first = '';

  it('is confirmed at once and due by the buyer’s terms', async () => {
    // 10 × ₦8,000 + ₦2,500 delivery = ₦82,500, within ₦100,000.
    const placed = await order(people.credit, 10);
    if (!placed.ok) throw new Error(placed.message);
    first = placed.orderId;
    const o = await row(first);
    expect(o).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'ON_ACCOUNT' });
    expect(Number(o.totalAmount)).toBe(82_500);
    const days = (o.accountDueAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(31.1);
    expect(paymentAllowsSending(o.paymentStatus)).toBe(true);
  });

  it('can’t go past the credit limit, counting what’s owed', async () => {
    // ₦82,500 owed; another ₦42,500 would make ₦125,000.
    const over = await order(people.credit, 5);
    expect(over).toMatchObject({ ok: false, code: 'invalid-payment-method' });
    expect(!over.ok && over.message).toContain('left of your credit');
    // Paying for it now is still fine.
    expect((await order(people.credit, 5, 'pod')).ok).toBe(true);
  });

  it('counts unpaid invoices in the balance, and refuses new credit while anything is overdue', async () => {
    await prisma.invoice.create({
      data: {
        organizationId: store.id,
        customerId: people.credit,
        invoiceNumber: `INV-${suffix}`,
        status: 'SENT',
        subtotal: 5_000,
        totalAmount: 5_000,
        dueDate: new Date(Date.now() - 86_400_000),
      },
    });
    const balance = await accountBalance(store.id, people.credit);
    expect(balance.owed).toBe(87_500);
    expect(balance.overdue).toBe(5_000);
    const refused = await order(people.credit, 1);
    expect(!refused.ok && refused.message).toContain('overdue');
    await prisma.invoice.updateMany({ where: { organizationId: store.id }, data: { status: 'PAID', paidAmount: 5_000 } });
  });

  it('takes part payments until it’s paid, and never more than is owed', async () => {
    const pay = (amount: number) =>
      recordAccountPayment({ organizationId: store.id, orderId: first, amount, method: 'transfer', reference: 'GTB-1', userId: null });
    expect(await pay(30_000)).toEqual({ ok: true, paid: false });
    expect(Number((await row(first)).accountPaidAmount)).toBe(30_000);
    expect(await pay(60_000)).toMatchObject({ ok: false });
    expect(await pay(52_500)).toEqual({ ok: true, paid: true });
    const paid = await row(first);
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.paidAt).not.toBeNull();
    expect(await prisma.orderAccountPayment.count({ where: { orderId: first } })).toBe(2);
    expect(await pay(1)).toMatchObject({ ok: false, error: 'This order isn’t on account.' });
    // Another shop can't record against it.
    expect(
      await recordAccountPayment({ organizationId: 'someone-else', orderId: first, amount: 1, method: 'cash', userId: null }),
    ).toMatchObject({ ok: false });
  });
});

describe('reminders', () => {
  it('go once each, and an order already well overdue gets the overdue one', async () => {
    const soon = await order(people.credit, 1);
    const late = await order(people.credit, 1);
    if (!soon.ok || !late.ok) throw new Error('setup');
    await prisma.order.update({ where: { id: soon.orderId }, data: { accountDueAt: new Date(Date.now() + 2 * 86_400_000) } });
    await prisma.order.update({ where: { id: late.orderId }, data: { accountDueAt: new Date(Date.now() - 8 * 86_400_000) } });

    expect(await remindAccountOrders({ organizationId: store.id })).toBe(2);
    expect((await row(soon.orderId)).accountReminders).toBe(1);
    expect((await row(late.orderId)).accountReminders).toBe(3);
    expect(await remindAccountOrders({ organizationId: store.id })).toBe(0);
  });
});
