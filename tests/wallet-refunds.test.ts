/*
 * Refunds straight back to the shopper's EduPay wallet (ROADMAP 20.6),
 * against the real database, with EduPay faked. What must hold: only an
 * order paid from a wallet is refunded to one; the money goes from the shop's
 * wallet to the shopper's, with the shop PIN, and only once EduPay says it
 * moved is the refund recorded — the same record, status and cap as any
 * other; a refusal records nothing; and the money moves at most once — a
 * refund in flight holds its amount, blocks another, and an unanswered one
 * is settled from the shop wallet's transactions, never sent again.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wallet/edupay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wallet/edupay')>()),
  edupayConfigured: () => true,
  walletEnvironment: () => 'test',
  getWallet: vi.fn(),
  getPinStatus: vi.fn(async () => ({ isSet: true, isLocked: false, lockedUntil: null })),
  transferFunds: vi.fn(),
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
import { debitForOrder, findTransfer, getWallet, transferFunds } from '@/lib/wallet/edupay';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { placeOrder } from '@/lib/storefront/orders/create';
import { payOrderFromWallet } from '@/lib/storefront/checkout/wallet-payment';
import { refundCancelledOrder, withdrawReturn } from '@/lib/storefront/orders/returns';
import { sendWalletRefund, settlePendingWalletRefunds, walletRefundOption } from '@/lib/storefront/orders/wallet-refunds';
import { UNANSWERED_TRANSFER_MS } from '@/lib/wallet/order-payment';
import type { CheckoutAddress } from '@/lib/storefront/checkout/types';

const transfer = vi.mocked(transferFunds);
const find = vi.mocked(findTransfer);
const balance = vi.mocked(getWallet);

const fixturesWas = process.env.STOREFRONT_FIXTURES;
process.env.STOREFRONT_FIXTURES = '0';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const store = { id: '', slug: `__test-wallet-refund-${suffix}` };
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

async function shopper() {
  n += 1;
  const customer = await prisma.customer.create({
    data: { organizationId: store.id, name: 'Ada', email: `ada-${n}-${suffix}@example.com`, phone: '+2348031234567', emailVerifiedAt: new Date() },
  });
  const wallet = { uuid: `u-${n}-${suffix}`, uniqId: `Q${n}` };
  await prisma.shopperWallet.create({
    data: { organizationId: store.id, customerId: customer.id, userRef: `shopper-${customer.id}`, status: 'ACTIVE', edupayUuid: wallet.uuid, edupayUniqId: wallet.uniqId, environment: 'test' },
  });
  return { ...customer, wallet };
}

/** An order paid from the shopper's wallet (20.5). */
async function paidOrder(paymentMethodId: 'wallet' | 'pod' = 'wallet') {
  const ada = await shopper();
  const config = await getStoreCheckoutConfig({ organizationSlug: store.slug }, { customerId: ada.id });
  const placed = await placeOrder({
    organizationSlug: store.slug,
    customerId: ada.id,
    lines: [{ productId, variantId: productId, quantity: 1 }],
    contact: { firstName: 'Ada', lastName: 'Okoro', email: ada.email ?? '', phone: '08012345678' },
    address: ADDRESS,
    deliveryMethodId,
    paymentMethodId,
    note: '',
    config,
  });
  if (!placed.ok) throw new Error(placed.message);
  if (paymentMethodId === 'wallet') {
    vi.mocked(debitForOrder).mockResolvedValueOnce({ kind: 'sent', reference: 'TXN-PAY', reply: { success: true } });
    const paid = await payOrderFromWallet({ organizationId: store.id, orderId: placed.orderId, customerId: ada.id, pin: '1234', returnUrl: '/x' });
    if (!paid.ok) throw new Error(`not paid: ${paid.reason}`);
  }
  const { totalAmount } = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId }, select: { totalAmount: true } });
  return { orderId: placed.orderId, total: Number(totalAmount), ada };
}

const cancel = (orderId: string) => prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
const refundOrder = (orderId: string, amount: number, pin = '4321') =>
  sendWalletRefund({ organizationId: store.id, target: { kind: 'order', orderId }, amount, pin, note: 'Sorry', performedById: null });
const orderRow = (id: string) =>
  prisma.order.findUniqueOrThrow({ where: { id }, select: { paymentStatus: true, refunds: { select: { amount: true, note: true } } } });
const walletRefunds = (orderId: string) => prisma.walletRefund.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  store.id = (await prisma.organization.create({ data: { name: 'Refund Store', slug: store.slug } })).id;
  const warehouse = await prisma.warehouse.create({ data: { organizationId: store.id, name: 'Main', sellsOnline: true, status: 'ACTIVE' } });
  deliveryMethodId = await giveStoreDelivery(store.id);
  const item = await prisma.inventoryItem.create({
    data: { organizationId: store.id, name: 'Tote', sku: `RTOTE-${suffix}`.slice(0, 40), slug: `rtote-${suffix}`.slice(0, 60), sellingPrice: 5000, isPublished: true, status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.inventoryLevel.create({ data: { inventoryItemId: item.id, warehouseId: warehouse.id, quantity: 200 } });
  productId = item.id;
  await prisma.merchantPaymentAccount.create({
    data: { organizationId: store.id, businessName: 'Refund Store', verificationStatus: 'VERIFIED', setupStatus: 'ACTIVE', paystackSubaccountCode: `ACCT_r_${suffix}` },
  });
  await prisma.shopWallet.create({
    data: { organizationId: store.id, userRef: `shop-${store.id}`, status: 'ACTIVE', edupayUuid: SHOP.uuid, edupayUniqId: SHOP.uniqId, environment: 'test' },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  if (fixturesWas === undefined) delete process.env.STOREFRONT_FIXTURES;
  else process.env.STOREFRONT_FIXTURES = fixturesWas;
  await prisma.walletRefund.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderRefund.deleteMany({ where: { organizationId: store.id } });
  await prisma.orderReturn.deleteMany({ where: { organizationId: store.id } });
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
  balance.mockResolvedValue({ balanceKobo: 1_000_000_00, currency: 'NGN', status: 'active', hasPin: true });
});

describe('which orders', () => {
  it('refunds to the wallet only an order paid from one', async () => {
    const wallet = await paidOrder('wallet');
    const cash = await paidOrder('pod');

    await expect(walletRefundOption(store.id, wallet.orderId)).resolves.toEqual({ shopBalance: 1_000_000, checking: false });
    await expect(walletRefundOption(store.id, cash.orderId)).resolves.toBeNull();
    await cancel(cash.orderId);
    await expect(refundOrder(cash.orderId, 100)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/wasn’t paid from a wallet/) });
    expect(transfer).not.toHaveBeenCalled();
  });
});

describe('sending', () => {
  it('sends it from the shop wallet to the shopper’s with the shop PIN, then records it like any refund', async () => {
    const { orderId, total, ada } = await paidOrder();
    await cancel(orderId);
    transfer.mockResolvedValueOnce({ kind: 'sent', reference: 'TXN-BACK', reply: { success: true } });

    await expect(refundOrder(orderId, total)).resolves.toEqual({ ok: true, data: 'sent' });

    const [from, to, input] = transfer.mock.calls[0];
    expect(from).toEqual(SHOP);
    expect(to).toEqual(ada.wallet);
    expect(input).toMatchObject({ amount: total, pin: '4321' });
    const [row] = await walletRefunds(orderId);
    expect(input.description).toContain(row.reference);
    expect(row).toMatchObject({ status: 'SENT', gatewayRef: 'TXN-BACK' });
    expect(row.orderRefundId).toBeTruthy();

    const order = await orderRow(orderId);
    expect(order.paymentStatus).toBe('REFUNDED');
    expect(order.refunds).toHaveLength(1);
    expect(order.refunds[0].note).toMatch(/^Sent to the customer’s wallet \(EduPay TXN-BACK\) Sorry/);
  });

  it('records nothing when EduPay refuses', async () => {
    const { orderId, total } = await paidOrder();
    await cancel(orderId);
    transfer.mockResolvedValueOnce({ kind: 'refused', reason: 'wrong-pin', message: 'Incorrect PIN' });

    await expect(refundOrder(orderId, total, '0000')).resolves.toEqual({ ok: false, error: 'That shop wallet PIN isn’t right.' });
    expect((await walletRefunds(orderId)).map((r) => r.status)).toEqual(['FAILED']);
    expect(await orderRow(orderId)).toMatchObject({ paymentStatus: 'PAID', refunds: [] });
  });

  it('says the shop wallet is short before spending the PIN on it', async () => {
    const { orderId, total } = await paidOrder();
    await cancel(orderId);
    balance.mockResolvedValue({ balanceKobo: 100, currency: 'NGN', status: 'active', hasPin: true });

    await expect(refundOrder(orderId, total)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/not enough/) });
    expect(transfer).not.toHaveBeenCalled();
    expect(await walletRefunds(orderId)).toHaveLength(0);
  });

  it('never sends more than the order paid', async () => {
    const { orderId, total } = await paidOrder();
    await cancel(orderId);
    await expect(refundOrder(orderId, total + 1)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/at most/) });
    expect(transfer).not.toHaveBeenCalled();
  });
});

describe('money moves at most once', () => {
  it('holds an unanswered refund’s amount, blocks another, and records it once it turns up', async () => {
    const { orderId, total } = await paidOrder();
    await cancel(orderId);
    transfer.mockResolvedValueOnce({ kind: 'unknown', reason: 'timed out' });

    await expect(refundOrder(orderId, total)).resolves.toEqual({ ok: true, data: 'checking' });
    find.mockResolvedValue('not-found'); // EduPay has no trace of it yet
    await expect(walletRefundOption(store.id, orderId)).resolves.toMatchObject({ checking: true });

    // Nothing more can go while it's in flight — not to the wallet, not by hand.
    await expect(refundOrder(orderId, 1)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/still being checked/) });
    await expect(refundCancelledOrder({ organizationId: store.id, orderId, amount: 1, performedById: null })).resolves.toMatchObject({ ok: false });
    expect(transfer).toHaveBeenCalledTimes(1);

    // It turns up among the shop wallet's transactions: recorded, once.
    const [row] = await walletRefunds(orderId);
    find.mockResolvedValue({ state: 'completed', reference: 'TXN-LATE' });
    await settlePendingWalletRefunds({ orderId });
    await settlePendingWalletRefunds({ orderId });
    expect(find).toHaveBeenCalledWith(SHOP, row.reference);
    expect((await walletRefunds(orderId))[0]).toMatchObject({ status: 'SENT', gatewayRef: 'TXN-LATE' });
    expect(await orderRow(orderId)).toMatchObject({ paymentStatus: 'REFUNDED' });
    expect((await orderRow(orderId)).refunds).toHaveLength(1);
  });

  it('closes an unanswered refund that never turns up, and frees its amount', async () => {
    const { orderId, total } = await paidOrder();
    await cancel(orderId);
    transfer.mockResolvedValueOnce({ kind: 'unknown', reason: 'network error' });
    await refundOrder(orderId, total);

    const [row] = await walletRefunds(orderId);
    await prisma.walletRefund.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - UNANSWERED_TRANSFER_MS - 60_000) } });
    find.mockResolvedValue('not-found');
    transfer.mockResolvedValueOnce({ kind: 'sent', reference: 'TXN-AGAIN', reply: { success: true } });

    await expect(refundOrder(orderId, total)).resolves.toEqual({ ok: true, data: 'sent' });
    expect((await walletRefunds(orderId)).map((r) => r.status)).toEqual(['ABANDONED', 'SENT']);
  });

  it('won’t let the shopper withdraw a return while its refund is on the way', async () => {
    const { orderId, ada } = await paidOrder();
    const ret = await prisma.orderReturn.create({ data: { organizationId: store.id, orderId, reason: 'damaged' } });
    transfer.mockResolvedValueOnce({ kind: 'unknown', reason: 'timed out' });

    await expect(
      sendWalletRefund({ organizationId: store.id, target: { kind: 'return', returnId: ret.id }, amount: 100, pin: '4321', restock: false, performedById: null }),
    ).resolves.toEqual({ ok: true, data: 'checking' });
    await expect(withdrawReturn({ organizationId: store.id, customerId: ada.id, returnId: ret.id })).resolves.toMatchObject({ ok: false });

    // EduPay confirms: the return is refunded.
    find.mockResolvedValue({ state: 'completed', reference: 'TXN-RET' });
    await settlePendingWalletRefunds({ orderId });
    await expect(prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } })).resolves.toMatchObject({ status: 'REFUNDED' });
    expect(await orderRow(orderId)).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED' });
  });
});
