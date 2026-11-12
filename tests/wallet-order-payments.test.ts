/*
 * Paying for an order from the shopper's EduPay wallet (ROADMAP 20.5),
 * against the real database, with EduPay faked. What must hold: the method
 * is offered only to a shop with an active wallet, and usable only by a
 * signed-in shopper with their own; the order is PAID only when EduPay says
 * the money moved, from the order's own shopper to the shop, for the order's
 * total; a refusal charges nothing and lets them try again; and money moves
 * at most once — a double press is one transfer, and an unanswered transfer
 * is never retried but settled from the shopper's transactions.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wallet/edupay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wallet/edupay')>()),
  edupayConfigured: vi.fn(() => true),
  walletEnvironment: () => 'test',
  getWallet: vi.fn(),
  getPinStatus: vi.fn(async () => ({ isSet: true, isLocked: false, lockedUntil: null })),
  debitForOrder: vi.fn(),
  findTransfer: vi.fn(),
}));
/* Emails are proved in tests/storefront-order-lifecycle.test.ts; never send real ones. */
vi.mock('@/lib/email', () => ({
  sendStorefrontOrderUpdateEmail: vi.fn(async () => {}),
  sendStoreOrderAlertEmail: vi.fn(async () => {}),
}));

import { prisma } from '@/lib/prisma';
import { giveStoreDelivery } from './helpers/delivery';
import { debitForOrder, edupayConfigured, findTransfer, getWallet } from '@/lib/wallet/edupay';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { placeOrder } from '@/lib/storefront/orders/create';
import { getOrderPaymentState, reconcileOpenAttempts } from '@/lib/storefront/checkout/payment-service';
import { payOrderFromWallet, walletPayView } from '@/lib/storefront/checkout/wallet-payment';
import { UNANSWERED_TRANSFER_MS } from '@/lib/wallet/order-payment';
import type { CheckoutAddress } from '@/lib/storefront/checkout/types';

const transfer = vi.mocked(debitForOrder);
const find = vi.mocked(findTransfer);
const balance = vi.mocked(getWallet);

const fixturesWas = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-wallet-pay-${suffix}` };
const SHOP = { uuid: `shop-u-${suffix}`, uniqId: 'SHOPQ' };
let productId = '';
let deliveryMethodId = '';
let n = 0;

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

async function shopper(name: string, { wallet = true, uuid }: { wallet?: boolean; uuid?: string } = {}) {
  n += 1;
  const customer = await prisma.customer.create({
    data: { organizationId: store.id, name, email: `${name.toLowerCase()}-${n}-${suffix}@example.com`, phone: '+2348031234567', emailVerifiedAt: new Date() },
  });
  if (wallet) {
    await prisma.shopperWallet.create({
      data: { organizationId: store.id, customerId: customer.id, userRef: `shopper-${customer.id}`, status: 'ACTIVE', edupayUuid: uuid ?? `u-${n}-${suffix}`, edupayUniqId: `Q${n}`, environment: 'test' },
    });
  }
  return customer;
}

async function walletOrder(customer: { id: string; email: string | null }) {
  const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { customerId: customer.id });
  const result = await placeOrder({
    organizationSlug: store.slug,
    customerId: customer.id,
    lines: [{ productId, variantId: productId, quantity: 1 }],
    contact: { firstName: 'Ada', lastName: 'Okoro', email: customer.email ?? '', phone: '08012345678' },
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId: 'wallet',
    note: '',
    config,
  });
  if (!result.ok) throw new Error(`could not place order: ${result.message}`);
  const total = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId }, select: { totalAmount: true } });
  return { ...result, total: Number(total.totalAmount) };
}

const pay = (orderId: string, customerId: string, pin = '1234') =>
  payOrderFromWallet({ organizationId: store.id, orderId, customerId, pin, returnUrl: '/checkout/confirmation?t=tok' });

const orderRow = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true, paymentStatus: true } });
const attempts = (orderId: string) => prisma.orderPayment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Wallet Store', slug: store.slug } })).id;
  const warehouse = await prisma.warehouse.create({ data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' } });
  deliveryMethodId = await giveStoreDelivery(store.id);
  const item = await prisma.inventoryItem.create({
    data: { organizationId: store.id, name: 'Tote', sku: `WTOTE-${suffix}`.slice(0, 40), slug: `wtote-${suffix}`.slice(0, 60), sellingPrice: 5000, isPublished: true, status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 200 } });
  productId = item.id;
  await prisma.merchantPaymentAccount.create({
    data: { organizationId: store.id, businessName: 'Wallet Store', verificationStatus: 'VERIFIED', setupStatus: 'ACTIVE', paystackSubaccountCode: `ACCT_w_${suffix}` },
  });
  await prisma.shopWallet.create({
    data: { organizationId: store.id, userRef: `shop-${store.id}`, status: 'ACTIVE', edupayUuid: SHOP.uuid, edupayUniqId: SHOP.uniqId, environment: 'test' },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  if (fixturesWas === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWas;
  await prisma.orderPayment.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderLineItem.deleteMany({ where: { order: { organizationId: store.id } } });
  await prisma.order.deleteMany({ where: { organizationId: store.id } });
  await prisma.stockMovement.deleteMany({ where: { organizationId: store.id } });
  await prisma.inventoryLevel.deleteMany({ where: { warehouse: { organizationId: store.id } } });
  await prisma.inventoryItem.deleteMany({ where: { organizationId: store.id } });
  await prisma.warehouse.deleteMany({ where: { organizationId: store.id } });
  await prisma.shopperWallet.deleteMany({ where: { organizationId: store.id } });
  await prisma.shopWallet.deleteMany({ where: { organizationId: store.id } });
  await prisma.customer.deleteMany({ where: { organizationId: store.id } });
  await prisma.merchantPaymentAccount.deleteMany({ where: { organizationId: store.id } });
  await prisma.organization.delete({ where: { id: store.id } });
});

beforeEach(() => {
  transfer.mockReset();
  find.mockReset();
  balance.mockReset();
  balance.mockResolvedValue({ balanceKobo: 100_000_00, currency: 'NGN', status: 'active', hasPin: true });
});

describe('offering it', () => {
  it('offers "Pay from wallet" to a signed-in shopper with a wallet, and explains it to anyone else', async () => {
    const ada = await shopper('Ada');
    const noWallet = await shopper('Bisi', { wallet: false });

    const mine = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { customerId: ada.id });
    expect(mine.paymentMethods.map((m) => m.id)).toEqual(expect.arrayContaining(['paystack', 'wallet']));
    expect(mine.paymentMethods.find((m) => m.id === 'wallet')).toMatchObject({ provider: 'edupay', unavailableReason: null });

    const guest = await getStoreCheckoutConfig({ organizationSlug: store.slug });
    expect(guest.paymentMethods.find((m) => m.id === 'wallet')?.unavailableReason).toMatch(/sign in/i);
    const waiting = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { customerId: noWallet.id });
    expect(waiting.paymentMethods.find((m) => m.id === 'wallet')?.unavailableReason).toMatch(/isn’t ready/);

    // …and the server refuses it the same way.
    const refused = await placeOrder({
      organizationSlug: store.slug,
      customerId: null,
      lines: [{ productId, variantId: productId, quantity: 1 }],
      contact: { firstName: 'Guest', lastName: 'Shopper', email: `guest-${suffix}@example.com`, phone: '08012345678' },
      address: ADDRESS,
      deliveryMethodId,
      paymentMethodId: 'wallet',
      note: '',
      config: guest,
    });
    expect(refused).toMatchObject({ ok: false, code: 'invalid-payment-method' });
  });

  it('isn’t offered by a shop without an active wallet', async () => {
    const ada = await shopper('Ada');
    await prisma.shopWallet.update({ where: { organizationId: store.id }, data: { status: 'FAILED' } });
    try {
      const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { customerId: ada.id });
      expect(config.paymentMethods.map((m) => m.id)).not.toContain('wallet');
    } finally {
      await prisma.shopWallet.update({ where: { organizationId: store.id }, data: { status: 'ACTIVE' } });
    }
  });
  it('isn’t offered anywhere while EduPay isn’t set up on this server — Paystack still is (go-live, ROADMAP A2)', async () => {
    const ada = await shopper('Ada');
    vi.mocked(edupayConfigured).mockReturnValue(false);
    try {
      const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { customerId: ada.id });
      expect(config.paymentMethods.map((m) => m.id)).not.toContain('wallet');
      expect(config.paymentMethods.map((m) => m.id)).toContain('paystack');
    } finally {
      vi.mocked(edupayConfigured).mockReturnValue(true);
    }
  });
});

describe('paying', () => {
  it('moves the order’s total from the shopper’s wallet to the shop’s, and only then is the order paid', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);
    expect(await orderRow(order.orderId)).toEqual({ status: 'PENDING', paymentStatus: 'AWAITING_PAYMENT' });
    await expect(walletPayView({ organizationId: store.id, orderId: order.orderId, customerId: ada.id })).resolves.toMatchObject({
      state: 'ready',
      totalKobo: order.total * 100,
      pinSet: true,
    });

    transfer.mockResolvedValueOnce({ kind: 'sent', reference: 'TXN123', reply: { success: true } });
    await expect(pay(order.orderId, ada.id)).resolves.toEqual({ ok: true });

    const [from, to, input] = transfer.mock.calls[0];
    const wallet = await prisma.shopperWallet.findUniqueOrThrow({ where: { customerId: ada.id } });
    expect(from).toEqual({ uuid: wallet.edupayUuid, uniqId: wallet.edupayUniqId });
    expect(to).toEqual(SHOP);
    expect(input).toMatchObject({ amount: order.total, pin: '1234', orderId: order.orderId });

    const [attempt] = await attempts(order.orderId);
    expect(attempt).toMatchObject({ provider: 'edupay', status: 'SUCCESS', gatewayRef: 'TXN123', channel: 'Wallet' });
    expect(input.reference).toBe(attempt.reference); // how an unanswered one is found later
    expect(input.description).toContain(attempt.reference);
    expect(await orderRow(order.orderId)).toEqual({ status: 'CONFIRMED', paymentStatus: 'PAID' });

    // Paid: nothing more to pay.
    await expect(pay(order.orderId, ada.id)).resolves.toEqual({ ok: false, reason: 'already-paid' });
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it('is only for the order’s own shopper', async () => {
    const ada = await shopper('Ada');
    const tunde = await shopper('Tunde');
    const order = await walletOrder(ada);

    await expect(pay(order.orderId, tunde.id)).resolves.toEqual({ ok: false, reason: 'not-yours' });
    await expect(walletPayView({ organizationId: store.id, orderId: order.orderId, customerId: tunde.id })).resolves.toEqual({ state: 'sign-in' });
    expect(transfer).not.toHaveBeenCalled();
  });

  it('says "not enough" before spending the PIN on it', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);
    balance.mockResolvedValue({ balanceKobo: 100, currency: 'NGN', status: 'active', hasPin: true });

    await expect(pay(order.orderId, ada.id)).resolves.toEqual({ ok: false, reason: 'insufficient' });
    expect(transfer).not.toHaveBeenCalled();
    expect(await attempts(order.orderId)).toHaveLength(0);
  });

  it('charges nothing on a refusal, and lets them try again', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);

    transfer.mockResolvedValueOnce({ kind: 'refused', reason: 'wrong-pin', message: 'Incorrect PIN' });
    await expect(pay(order.orderId, ada.id, '9999')).resolves.toEqual({ ok: false, reason: 'wrong-pin' });
    expect(await orderRow(order.orderId)).toMatchObject({ paymentStatus: 'AWAITING_PAYMENT' });
    await expect(getOrderPaymentState(order.orderId)).resolves.toMatchObject({ canPay: true, method: 'wallet', lastAttemptFailed: true, checking: false });

    transfer.mockResolvedValueOnce({ kind: 'sent', reference: 'TXN2', reply: { success: true } });
    await expect(pay(order.orderId, ada.id)).resolves.toEqual({ ok: true });
    expect((await attempts(order.orderId)).map((a) => a.status)).toEqual(['FAILED', 'SUCCESS']);
  });

  it('refuses a PIN that isn’t four digits without asking EduPay', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);
    await expect(pay(order.orderId, ada.id, '12a4')).resolves.toEqual({ ok: false, reason: 'bad-pin' });
    expect(transfer).not.toHaveBeenCalled();
  });

  it('never pays the shop from the shop’s own wallet', async () => {
    const owner = await shopper('Owner', { uuid: SHOP.uuid });
    const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { customerId: owner.id });
    expect(config.paymentMethods.find((m) => m.id === 'wallet')?.unavailableReason).toMatch(/store’s own wallet/);
  });
});

describe('money moves at most once', () => {
  it('turns a double press into one transfer', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);
    transfer.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { kind: 'sent', reference: 'TXN-ONCE', reply: { success: true } };
    });
    find.mockResolvedValue('not-found');

    const results = await Promise.all([pay(order.orderId, ada.id), pay(order.orderId, ada.id)]);

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(results).toEqual(expect.arrayContaining([{ ok: true }]));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await orderRow(order.orderId)).toMatchObject({ paymentStatus: 'PAID' });
  });

  it('never retries an unanswered transfer — it waits, and is settled from the shopper’s transactions', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);

    transfer.mockResolvedValueOnce({ kind: 'unknown', reason: 'timed out' });
    await expect(pay(order.orderId, ada.id)).resolves.toEqual({ ok: false, reason: 'checking' });
    await expect(getOrderPaymentState(order.orderId)).resolves.toMatchObject({ checking: true });

    // Pressing again while EduPay hasn't been heard from: no second transfer.
    find.mockResolvedValueOnce('not-found');
    await expect(pay(order.orderId, ada.id)).resolves.toEqual({ ok: false, reason: 'checking' });
    expect(transfer).toHaveBeenCalledTimes(1);

    // It turns up in the wallet: the order is paid.
    const [attempt] = await attempts(order.orderId);
    find.mockResolvedValueOnce({ state: 'completed', reference: 'TXN-LATE' });
    await reconcileOpenAttempts(order.orderId);
    expect(find).toHaveBeenLastCalledWith(expect.anything(), attempt.reference);
    expect(await orderRow(order.orderId)).toEqual({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect((await attempts(order.orderId))[0]).toMatchObject({ status: 'SUCCESS', gatewayRef: 'TXN-LATE' });
  });

  it('closes an unanswered transfer that never turns up, so they can pay again', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);
    transfer.mockResolvedValueOnce({ kind: 'unknown', reason: 'network error' });
    await pay(order.orderId, ada.id);

    const [attempt] = await attempts(order.orderId);
    await prisma.orderPayment.update({ where: { id: attempt.id }, data: { createdAt: new Date(Date.now() - UNANSWERED_TRANSFER_MS - 60_000) } });
    find.mockResolvedValue('not-found');
    transfer.mockResolvedValueOnce({ kind: 'sent', reference: 'TXN-AGAIN', reply: { success: true } });

    await expect(pay(order.orderId, ada.id)).resolves.toEqual({ ok: true });
    expect((await attempts(order.orderId)).map((a) => a.status)).toEqual(['ABANDONED', 'SUCCESS']);
  });

  it('keeps an unanswered one open while EduPay can’t be asked', async () => {
    const ada = await shopper('Ada');
    const order = await walletOrder(ada);
    transfer.mockResolvedValueOnce({ kind: 'unknown', reason: 'timed out' });
    await pay(order.orderId, ada.id);

    const [attempt] = await attempts(order.orderId);
    await prisma.orderPayment.update({ where: { id: attempt.id }, data: { createdAt: new Date(Date.now() - UNANSWERED_TRANSFER_MS - 60_000) } });
    find.mockResolvedValue('unavailable');
    await reconcileOpenAttempts(order.orderId);
    expect((await attempts(order.orderId))[0].status).toBe('PENDING');
  });
});
