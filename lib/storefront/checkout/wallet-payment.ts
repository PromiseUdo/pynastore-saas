/*
 * lib/storefront/checkout/wallet-payment.ts
 *
 * Paying for an order from the shopper's EduPay wallet (ROADMAP 20.5).
 * Server only.
 *
 * THE FLOW. The order is placed like any online order — stock held, waiting
 * for payment. On the confirmation page (or the shopper's own order page) the
 * shopper sees their balance and types their wallet PIN; we then ask EduPay
 * for ONE `debit_wallet` from their wallet with the shop's wallet as receiver,
 * carrying the order's id, and the order is paid only when EduPay says the
 * money moved. The platform never holds it.
 *
 * WHO. Only the order's own signed-in shopper, from their own wallet: the
 * confirmation link can be shared, a wallet can't. Never into the shop's
 * wallet from that same wallet (an owner shopping at their own shop with a
 * connected wallet, 20.4).
 *
 * ONCE. Every press is an OrderPayment row (provider 'edupay') with its own
 * reference, written in the transfer's description. Before one is written,
 * the order row is locked and any earlier attempt must be settled: so a
 * double-click, two tabs or a retry move the money at most once. An attempt
 * EduPay doesn't clearly answer stays open ("checking") and is settled from
 * the shopper's transactions (lib/wallet/order-payment.ts) — never retried.
 *
 * The PIN goes to EduPay and nowhere else: never stored, logged or returned.
 */
import { randomBytes } from 'crypto';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { debitForOrder, getPinStatus, getWallet } from '@/lib/wallet/edupay';
import { isPinShape } from '@/lib/wallet/pin';
import { activeShopperWalletIds } from '@/lib/wallet/shopper';
import { activeShopWalletIds } from '@/lib/wallet/shop';
import { WALLET_PROVIDER } from '@/lib/wallet/order-payment';
import { WALLET_PAYMENT_METHOD, markAttemptPaid, reconcileOpenAttempts } from './payment-service';

const PAYABLE_ORDER_STATUSES = ['PENDING', 'CONFIRMED'];

/** Major-unit Decimal → kobo, without float drift. */
const toKobo = (amount: Prisma.Decimal) => amount.times(100).toDecimalPlaces(0).toNumber();

/* ---------------- may this store take wallet payments? ---------------- */

export type WalletCheckoutAvailability =
  /** offered, and this shopper can use it */
  | { offered: true; reason: null }
  /** offered by the store, but not to this shopper yet — say why */
  | { offered: true; reason: string }
  | { offered: false };

/**
 * Checkout's "Pay from wallet": the store must be able to take online
 * payments and have an active wallet; the shopper must be signed in, with an
 * active wallet that isn't the shop's own.
 */
export async function walletCheckoutAvailability(organizationId: string, customerId: string | null): Promise<WalletCheckoutAvailability> {
  const shop = await activeShopWalletIds(organizationId);
  if (!shop) return { offered: false };
  if (!customerId) return { offered: true, reason: 'Sign in to pay from your wallet.' };
  const mine = await activeShopperWalletIds(customerId);
  if (!mine) return { offered: true, reason: 'Your wallet isn’t ready yet. It’s set up once your email is confirmed.' };
  if (mine.uuid === shop.uuid) return { offered: true, reason: 'This is the store’s own wallet, so it can’t pay the store.' };
  return { offered: true, reason: null };
}

/* ---------------- the page's view ---------------- */

export type WalletPayView =
  | { state: 'ready'; balanceKobo: number; totalKobo: number; pinSet: boolean; pinLocked: boolean }
  /** the order isn't this signed-in shopper's (or nobody is signed in) */
  | { state: 'sign-in' }
  | { state: 'unavailable' };

export async function walletPayView(input: { organizationId: string; orderId: string; customerId: string | null }): Promise<WalletPayView> {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    select: { customerId: true, totalAmount: true },
  });
  if (!order) return { state: 'unavailable' };
  if (!input.customerId || order.customerId !== input.customerId) return { state: 'sign-in' };
  const ids = await activeShopperWalletIds(input.customerId);
  if (!ids) return { state: 'unavailable' };
  const [wallet, pin] = await Promise.all([getWallet(ids), getPinStatus(ids)]);
  if (!wallet) return { state: 'unavailable' };
  return {
    state: 'ready',
    balanceKobo: wallet.balanceKobo,
    totalKobo: toKobo(order.totalAmount),
    pinSet: pin?.isSet ?? wallet.hasPin,
    pinLocked: pin?.isLocked ?? false,
  };
}

/* ---------------- paying ---------------- */

export type WalletPayResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'already-paid'
        | 'not-payable'
        | 'not-yours'
        | 'no-wallet'
        | 'shop-unavailable'
        | 'same-wallet'
        | 'bad-pin'
        | 'pin-not-set'
        | 'wrong-pin'
        | 'locked'
        | 'insufficient'
        /** an earlier press hasn't been answered yet — it may have gone through */
        | 'checking'
        | 'unavailable'
        | 'rejected';
    };

const fail = (reason: Extract<WalletPayResult, { ok: false }>['reason']): WalletPayResult => ({ ok: false, reason });

function attemptReference(orderReference: string): string {
  return `${orderReference}-W${randomBytes(5).toString('hex').toUpperCase()}`;
}

export async function payOrderFromWallet(input: {
  organizationId: string;
  orderId: string;
  /** the signed-in shopper, from the session */
  customerId: string;
  pin: string;
  /** the confirmation page, kept on the attempt like any other */
  returnUrl: string;
}): Promise<WalletPayResult> {
  if (!isPinShape(input.pin)) return fail('bad-pin');

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId, channel: 'ONLINE' },
    select: {
      id: true,
      reference: true,
      customerId: true,
      paymentMethod: true,
      totalAmount: true,
      currency: true,
      organization: { select: { name: true } },
    },
  });
  if (!order) return fail('not-payable');
  if (order.customerId !== input.customerId) return fail('not-yours');

  // An earlier press may have been paid without us hearing: settle it first.
  await reconcileOpenAttempts(order.id);
  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, paymentStatus: true } });
  if (fresh.paymentStatus === 'PAID') return fail('already-paid');
  if (
    order.paymentMethod !== WALLET_PAYMENT_METHOD ||
    fresh.paymentStatus !== 'AWAITING_PAYMENT' ||
    !PAYABLE_ORDER_STATUSES.includes(fresh.status) ||
    order.currency.toUpperCase() !== 'NGN'
  ) {
    return fail('not-payable');
  }

  const [from, to] = await Promise.all([activeShopperWalletIds(input.customerId), activeShopWalletIds(input.organizationId)]);
  if (!from) return fail('no-wallet');
  if (!to) return fail('shop-unavailable');
  if (from.uuid === to.uuid) return fail('same-wallet');

  // Not enough money is said before the PIN is spent on it.
  const wallet = await getWallet(from);
  if (!wallet) return fail('unavailable');
  if (wallet.balanceKobo < toKobo(order.totalAmount)) return fail('insufficient');

  const reference = attemptReference(order.reference);
  const attempt = await prisma.$transaction(async (tx) => {
    // One press at a time per order: whoever holds the row decides.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
    const open = await tx.orderPayment.count({ where: { orderId: order.id, status: 'PENDING' } });
    if (open > 0) return null;
    const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentStatus: true } });
    if (current.paymentStatus !== 'AWAITING_PAYMENT') return null;
    return tx.orderPayment.create({
      data: {
        organizationId: input.organizationId,
        orderId: order.id,
        provider: WALLET_PROVIDER,
        reference,
        amount: order.totalAmount,
        currency: order.currency,
        returnUrl: input.returnUrl,
      },
      select: { id: true, orderId: true },
    });
  });
  if (!attempt) return fail('checking');

  const result = await debitForOrder(from, to, {
    amount: order.totalAmount.toDecimalPlaces(2).toNumber(),
    description: `Order ${order.reference} at ${order.organization.name} (${reference})`,
    // The order's id, not its reference: ORD-1042 exists at many stores, and one wallet can shop at them all.
    orderId: order.id,
    reference,
    orderReference: order.reference,
    pin: input.pin,
  });

  if (result.kind === 'sent') {
    await markAttemptPaid(attempt, {
      channel: 'Wallet',
      gatewayRef: result.reference,
      providerPayload: result.reply as Prisma.InputJsonValue,
    });
    return { ok: true };
  }

  if (result.kind === 'refused') {
    await prisma.orderPayment.updateMany({
      where: { id: attempt.id, status: 'PENDING' },
      data: { status: 'FAILED', verifiedAt: new Date(), providerPayload: { refused: result.reason, message: result.message } },
    });
    return fail(result.reason);
  }

  // No clear answer: it stays open, and is settled from the shopper's transactions.
  console.error(`[wallet] ${reference}: debit_wallet unanswered (${result.reason}) — left to settle from the wallet's transactions`);
  await prisma.orderPayment.update({ where: { id: attempt.id }, data: { providerPayload: { unanswered: result.reason } } });
  return fail('checking');
}
