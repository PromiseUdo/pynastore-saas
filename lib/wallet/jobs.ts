/*
 * lib/wallet/jobs.ts
 *
 * The `wallet-setup` cron job (lib/cron/jobs.ts), every 15 minutes:
 * wallets EduPay didn't answer for (./shopper.ts, ./shop.ts), top-ups
 * nobody stayed to see through (./top-up.ts), and refunds to a wallet EduPay
 * didn't clearly answer (lib/storefront/orders/wallet-refunds.ts), and
 * withdrawals to a shop's bank (./payouts.ts). Its own file so the wallet
 * modules don't import each other in a circle.
 */
import { edupayConfigured } from './edupay';
import { retryDueWallets } from './shopper';
import { settlePendingTopUps } from './top-up';
import { settleWithdrawals } from './payouts';
import { settlePendingWalletRefunds } from '@/lib/storefront/orders/wallet-refunds';

export async function runWalletJob({ limit = 50, now = new Date() }: { limit?: number; now?: Date } = {}) {
  if (!edupayConfigured()) {
    return { due: 0, active: 0, waiting: 0, failed: 0, topUpsChecked: 0, topUpsCompleted: 0, topUpsFailed: 0, refundsChecked: 0, refundsSent: 0, withdrawalsChecked: 0, withdrawalsReturned: 0 };
  }
  const wallets = await retryDueWallets({ limit, now });
  const topUps = await settlePendingTopUps({ limit, now });
  const refunds = await settlePendingWalletRefunds({ limit, now });
  const withdrawals = await settleWithdrawals({ limit, now });
  return {
    ...wallets,
    topUpsChecked: topUps.checked,
    topUpsCompleted: topUps.completed,
    topUpsFailed: topUps.failed,
    refundsChecked: refunds.checked,
    refundsSent: refunds.sent,
    withdrawalsChecked: withdrawals.checked,
    withdrawalsReturned: withdrawals.returned,
  };
}
