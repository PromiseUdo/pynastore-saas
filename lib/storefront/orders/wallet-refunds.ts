/*
 * lib/storefront/orders/wallet-refunds.ts
 *
 * Refunds straight back to the shopper's EduPay wallet (ROADMAP 20.6), for an
 * order they paid from it (20.5). Server only; no permission checks — the
 * merchant's action (features/sales/order-returns.ts) checks
 * `sales.return.manage` and then calls these.
 *
 * THE FLOW. One `transfer_funds` from the shop's wallet to the shopper's,
 * with the SHOP wallet's PIN, which the merchant types. Then — and only once
 * EduPay has said the money moved — the refund is recorded through the same
 * functions as any other (./returns.ts): the same cap, the same payment
 * status, the same restocking, an email that says it's in their wallet.
 *
 *   check (order locked) ─▶ WalletRefund PENDING ─▶ transfer_funds
 *        sent ─▶ recorded, SENT          refused ─▶ FAILED, nothing moved
 *        no clear answer ─▶ stays PENDING, settled from the shop wallet's
 *        transactions (by our reference) — never sent again
 *
 * ONCE. The WalletRefund is written under the order's lock before EduPay is
 * asked, and holds its amount while it's in flight: two refunds can't both
 * take the last naira, and none starts while another is unanswered.
 *
 * The PIN goes to EduPay and nowhere else: never stored, logged or returned.
 */
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { findTransfer, getWallet, transferFunds, type TransferResult, type WalletIds } from '@/lib/wallet/edupay';
import { isPinShape } from '@/lib/wallet/pin';
import { activeShopperWalletIds } from '@/lib/wallet/shopper';
import { activeShopWalletIds } from '@/lib/wallet/shop';
import { UNANSWERED_TRANSFER_MS, WALLET_PROVIDER } from '@/lib/wallet/order-payment';
import { formatMoney } from '../format';
import { refundableAmount } from './policy';
import { refundCancelledOrder, refundReturn, type ReturnResult } from './returns';

export type WalletRefundTarget = { kind: 'return'; returnId: string } | { kind: 'order'; orderId: string };

/* ---------------- can this order be refunded to the wallet? ---------------- */

interface Wallets {
  shop: WalletIds;
  shopper: WalletIds;
}

/**
 * An order the shopper paid from their wallet, with both wallets still
 * active — the only kind refunded this way. Anything else is refunded the
 * old way: sent by the merchant, then recorded.
 */
async function walletsFor(organizationId: string, orderId: string): Promise<Wallets | null> {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      organizationId,
      paymentMethod: 'wallet',
      payments: { some: { provider: WALLET_PROVIDER, status: 'SUCCESS' } },
    },
    select: { customerId: true },
  });
  if (!order?.customerId) return null;
  const [shop, shopper] = await Promise.all([activeShopWalletIds(organizationId), activeShopperWalletIds(order.customerId)]);
  return shop && shopper ? { shop, shopper } : null;
}

export interface WalletRefundOption {
  /** naira in the shop wallet; null when EduPay couldn't be asked */
  shopBalance: number | null;
  /** a refund EduPay hasn't answered yet — say so, and don't start another */
  checking: boolean;
}

/** For the order page: refund to the wallet, or the old way (null). Settles an unanswered one first. */
export async function walletRefundOption(organizationId: string, orderId: string): Promise<WalletRefundOption | null> {
  const wallets = await walletsFor(organizationId, orderId);
  if (!wallets) return null;
  await settlePendingWalletRefunds({ orderId });
  const [wallet, pending] = await Promise.all([
    getWallet(wallets.shop),
    prisma.walletRefund.count({ where: { orderId, status: 'PENDING' } }),
  ]);
  return { shopBalance: wallet ? wallet.balanceKobo / 100 : null, checking: pending > 0 };
}

/* ---------------- sending ---------------- */

export type WalletRefundOutcome =
  /** sent and recorded; the shopper has been emailed */
  | 'sent'
  /** EduPay didn't clearly answer — it may have gone; it is being checked, never sent again */
  | 'checking';

const REFUSED: Record<Extract<TransferResult, { kind: 'refused' }>['reason'], string> = {
  'wrong-pin': 'That shop wallet PIN isn’t right.',
  locked: 'The shop wallet PIN is locked after too many wrong tries. Please try again later.',
  'pin-not-set': 'Create the shop wallet PIN first, in Settings → Payments → Shop wallet.',
  insufficient: 'There isn’t enough in the shop wallet for this refund. Add money to it first.',
  rejected: 'EduPay couldn’t send this refund. Nothing was sent.',
};

function refundReference(orderReference: string): string {
  return `${orderReference}-R${randomBytes(5).toString('hex').toUpperCase()}`;
}

export async function sendWalletRefund(input: {
  organizationId: string;
  target: WalletRefundTarget;
  /** major units */
  amount: number;
  note?: string | null;
  restock?: boolean;
  /** the shop wallet's PIN, as the merchant typed it */
  pin: string;
  performedById: string | null;
}): Promise<ReturnResult<WalletRefundOutcome>> {
  if (!isPinShape(input.pin)) return { ok: false, error: 'Enter the shop wallet’s 4-digit PIN.' };
  const amount = Math.round(input.amount * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter the amount to send back.' };

  // Which order, and is the thing being refunded still waiting for it?
  let orderId: string;
  let returnId: string | null = null;
  if (input.target.kind === 'return') {
    const found = await prisma.orderReturn.findFirst({
      where: { id: input.target.returnId, organizationId: input.organizationId },
      select: { id: true, orderId: true, status: true },
    });
    if (!found) return { ok: false, error: 'We couldn’t find that return.' };
    if (found.status !== 'REQUESTED' && found.status !== 'APPROVED') return { ok: false, error: 'This return has already been settled.' };
    orderId = found.orderId;
    returnId = found.id;
  } else {
    orderId = input.target.orderId;
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, organizationId: input.organizationId },
    select: { id: true, reference: true, status: true, currency: true, organization: { select: { name: true } } },
  });
  if (!order) return { ok: false, error: 'Order not found' };
  if (input.target.kind === 'order' && order.status !== 'CANCELLED') {
    return { ok: false, error: 'Only a cancelled order is refunded here. For delivered items, use the customer’s return.' };
  }

  const wallets = await walletsFor(input.organizationId, order.id);
  if (!wallets) return { ok: false, error: 'This order wasn’t paid from a wallet that’s still connected, so it can’t be refunded to one.' };

  // An earlier one may have gone through unheard: settle it before another.
  await settlePendingWalletRefunds({ orderId: order.id });

  // Not enough in the shop wallet is said before the PIN is spent on it.
  const shopWallet = await getWallet(wallets.shop);
  if (!shopWallet) return { ok: false, error: 'We couldn’t reach EduPay just now. Nothing was sent — please try again in a minute.' };
  if (shopWallet.balanceKobo < Math.round(amount * 100)) {
    return {
      ok: false,
      error: `The shop wallet has ${formatMoney(shopWallet.balanceKobo, order.currency)} — not enough for this refund. Add money to it first.`,
    };
  }

  const reference = refundReference(order.reference);
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE`;
    if (await tx.walletRefund.count({ where: { orderId: order.id, status: 'PENDING' } })) {
      return { ok: false as const, error: 'A refund to the customer’s wallet is still being checked with EduPay. Try again in a few minutes.' };
    }
    if (returnId) {
      const current = await tx.orderReturn.findUnique({ where: { id: returnId }, select: { status: true } });
      if (current?.status !== 'REQUESTED' && current?.status !== 'APPROVED') return { ok: false as const, error: 'This return has already been settled.' };
    }
    const row = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { paymentStatus: true, totalAmount: true, refunds: { select: { amount: true } } },
    });
    const left = refundableAmount({
      paymentStatus: row.paymentStatus,
      total: Number(row.totalAmount),
      refunded: row.refunds.reduce((sum, r) => sum + Number(r.amount), 0),
    });
    if (left <= 0) return { ok: false as const, error: 'There’s nothing left to refund on this order.' };
    if (amount > left) return { ok: false as const, error: `You can refund at most ${formatMoney(Math.round(left * 100), order.currency)} on this order.` };

    const created = await tx.walletRefund.create({
      data: {
        organizationId: input.organizationId,
        orderId: order.id,
        returnId,
        reference,
        amount,
        note: input.note?.trim().slice(0, 500) || null,
        restock: Boolean(input.restock) && returnId !== null,
        performedById: input.performedById,
      },
      select: { id: true },
    });
    return { ok: true as const, id: created.id };
  });
  if (!reserved.ok) return reserved;

  const result = await transferFunds(wallets.shop, wallets.shopper, {
    amount,
    description: `Refund for order ${order.reference} from ${order.organization.name} (${reference})`,
    pin: input.pin,
  });

  if (result.kind === 'refused') {
    await prisma.walletRefund.updateMany({
      where: { id: reserved.id, status: 'PENDING' },
      data: { status: 'FAILED', settledAt: new Date(), lastError: result.message ?? result.reason },
    });
    return { ok: false, error: REFUSED[result.reason] };
  }
  if (result.kind === 'unknown') {
    console.error(`[wallet] ${reference}: refund transfer unanswered (${result.reason}) — left to settle from the shop wallet's transactions`);
    await prisma.walletRefund.update({ where: { id: reserved.id }, data: { lastError: `No clear answer from EduPay (${result.reason})` } });
    return { ok: true, data: 'checking' };
  }

  await prisma.walletRefund.update({ where: { id: reserved.id }, data: { gatewayRef: result.reference } });
  const recorded = await recordSentRefund(reserved.id);
  return recorded.ok ? { ok: true, data: 'sent' } : recorded;
}

/**
 * EduPay moved the money: record the refund as any other, linked to this
 * transfer. If recording is refused now (the shopper withdrew the return in
 * between, say), the money has still gone — it's flagged for a person, never
 * undone or sent again.
 */
async function recordSentRefund(walletRefundId: string): Promise<ReturnResult> {
  const row = await prisma.walletRefund.findUniqueOrThrow({ where: { id: walletRefundId } });
  const note = ['Sent to the customer’s wallet', row.gatewayRef ? `(EduPay ${row.gatewayRef})` : null, row.note]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
  const common = { amount: Number(row.amount), note, performedById: row.performedById, walletRefundId: row.id };
  const result = row.returnId
    ? await refundReturn({ organizationId: row.organizationId, returnId: row.returnId, restock: row.restock, ...common })
    : await refundCancelledOrder({ organizationId: row.organizationId, orderId: row.orderId, ...common });
  if (result.ok) return result;

  const fresh = await prisma.walletRefund.findUnique({ where: { id: row.id }, select: { status: true } });
  if (fresh?.status === 'SENT') return { ok: true, data: undefined }; // recorded by someone else meanwhile
  console.error(`[wallet] ${row.reference}: refund sent but not recorded — ${result.error}`);
  await prisma.walletRefund.update({
    where: { id: row.id },
    data: { status: 'SENT', settledAt: new Date(), lastError: `Sent, but not recorded: ${result.error}` },
  });
  return {
    ok: false,
    error: `The money was sent to the customer’s wallet, but we couldn’t record the refund (${result.error}). Please contact support so it can be put right.`,
  };
}

/* ---------------- settling unanswered ones ---------------- */

/**
 * Wallet refunds EduPay never clearly answered: look for each among the
 * shop wallet's transactions by our reference. Found and completed → recorded;
 * found and failed, or nowhere long after → closed, nothing was sent. Never
 * while EduPay can't be asked. Run from the order page, before a new refund,
 * and by the `wallet-setup` job.
 */
export async function settlePendingWalletRefunds({
  orderId,
  limit = 50,
  now = new Date(),
}: { orderId?: string; limit?: number; now?: Date } = {}) {
  const rows = await prisma.walletRefund.findMany({
    where: { status: 'PENDING', ...(orderId ? { orderId } : { createdAt: { lt: new Date(now.getTime() - 60_000) } }) },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, organizationId: true, reference: true, createdAt: true },
  });
  const counts = { checked: rows.length, sent: 0, failed: 0 };
  for (const row of rows) {
    const shop = await activeShopWalletIds(row.organizationId);
    if (!shop) continue;
    const found = await findTransfer(shop, row.reference);
    if (found === 'unavailable') continue;
    if (found === 'not-found') {
      if (now.getTime() - row.createdAt.getTime() > UNANSWERED_TRANSFER_MS) {
        await prisma.walletRefund.updateMany({
          where: { id: row.id, status: 'PENDING' },
          data: { status: 'ABANDONED', settledAt: now, lastError: 'EduPay has no record of it — nothing was sent' },
        });
        counts.failed += 1;
      }
      continue;
    }
    if (found.state === 'completed') {
      await prisma.walletRefund.update({ where: { id: row.id }, data: { gatewayRef: found.reference } });
      if ((await recordSentRefund(row.id)).ok) counts.sent += 1;
    } else if (found.state === 'failed') {
      await prisma.walletRefund.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'FAILED', settledAt: now, lastError: 'EduPay reports the transfer failed' },
      });
      counts.failed += 1;
    }
  }
  return counts;
}
