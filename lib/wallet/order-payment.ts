/*
 * lib/wallet/order-payment.ts
 *
 * What became of a wallet payment for an order (ROADMAP 20.5) that EduPay
 * never clearly answered — a timeout, a crash. Server only.
 *
 * Such an attempt may or may not have moved the money, so it is never
 * simply tried again: we look for the transfer among the shopper's own
 * transactions, by the reference we put in its description. Only the
 * verdict lives here; settling the order is the payment service's
 * (lib/storefront/checkout/payment-service.ts), which asks this module.
 */
import { prisma } from '@/lib/prisma';
import { findTransfer } from './edupay';
import { activeShopperWalletIds } from './shopper';

/** OrderPayment.provider for a wallet payment. */
export const WALLET_PROVIDER = 'edupay';

/**
 * How long an unanswered transfer may still turn up in the shopper's
 * transactions. Past this, with EduPay reachable and no trace of it, it
 * never happened, and the shopper may pay again.
 */
export const UNANSWERED_TRANSFER_MS = 15 * 60_000;

export type WalletAttemptVerdict =
  | { kind: 'paid'; gatewayRef: string | null }
  | { kind: 'failed' }
  | { kind: 'abandoned' }
  | { kind: 'pending' }
  | { kind: 'unavailable' };

export async function walletAttemptVerdict(attemptId: string, now = new Date()): Promise<WalletAttemptVerdict> {
  const attempt = await prisma.orderPayment.findUnique({
    where: { id: attemptId },
    select: { reference: true, status: true, createdAt: true, order: { select: { customerId: true } } },
  });
  if (!attempt || attempt.status !== 'PENDING' || !attempt.order.customerId) return { kind: 'pending' };

  const ids = await activeShopperWalletIds(attempt.order.customerId);
  if (!ids) return { kind: 'unavailable' };

  const found = await findTransfer(ids, attempt.reference);
  if (found === 'unavailable') return { kind: 'unavailable' };
  if (found === 'not-found') {
    return now.getTime() - attempt.createdAt.getTime() > UNANSWERED_TRANSFER_MS ? { kind: 'abandoned' } : { kind: 'pending' };
  }
  if (found.state === 'completed') return { kind: 'paid', gatewayRef: found.reference };
  if (found.state === 'failed') return { kind: 'failed' };
  return { kind: 'pending' };
}
