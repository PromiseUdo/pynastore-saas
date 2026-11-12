/*
 * lib/wallet/payouts.ts
 *
 * Money leaving the shop wallet for the shop's bank (ROADMAP 20.7). Server
 * only; no permission checks — features/settings/shop-wallet-payouts.ts lets
 * only the shop's Owner in, then calls these.
 *
 * WHERE IT CAN GO. Only the shop's verified settlement account, the one
 * platform staff reviewed (Settings → Payments). The account's details come
 * from our record, never the browser, and its bank code is Paystack's, as
 * EduPay's are. Changing it means going through that review again.
 *
 * TWO WAYS, NEVER BOTH. By hand (EduPay emails a code to the wallet's address,
 * and the Owner types it), or on a schedule (auto-withdraw). While auto-withdraw
 * is on, a withdrawal by hand is refused, here on the server — and if EduPay
 * can't say whether it's on, that is a refusal too, not "off".
 *
 * ONCE. A WalletWithdrawal is written under the shop's lock before EduPay is
 * asked, and only one may be open. Using the code claims it, so a double press
 * confirms once. An unclear answer stays CONFIRMING and is settled from the
 * wallet's transactions by our reference — the code is never sent again.
 *
 * AFTERWARDS. EduPay's success means it debited the wallet and STARTED the bank
 * transfer, so we say "sent", never "arrived". If the transfer fails, EduPay
 * puts the money back; when that shows in the transactions the withdrawal is
 * RETURNED and the Owner is told.
 *
 * Codes go to EduPay and nowhere else: never stored, logged or returned.
 */
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { formatMoney } from '@/lib/format';
import { listOwnerNotice } from '@/lib/notifications/owner-notices';
import {
  confirmAddBankAccount,
  confirmWithdraw,
  getAutoWithdraw,
  getAutoWithdrawHistory,
  getBankAccounts,
  getWallet,
  requestAddBankAccount,
  requestWithdraw,
  updateAutoWithdraw,
  withdrawalState,
  type AutoWithdrawRun,
  type AutoWithdrawSettings,
  type WalletIds,
} from './edupay';
import { activeShopWalletIds } from './shop';

/** Naira: EduPay's own minimum. */
export const MIN_WITHDRAWAL = 100;
/** An emailed code is treated as dead after this long. */
const CODE_LIFETIME_MS = 15 * 60_000;
/** An unanswered confirmation with no trace after this long never happened. */
const UNANSWERED_MS = 15 * 60_000;
/** How long a sent withdrawal is watched for its money coming back. */
const WATCH_SENT_MS = 3 * 24 * 60 * 60_000;

/** Whole naira, typed with or without commas. Null when it isn't one. */
export function parseWithdrawalAmount(raw: string): number | null {
  const cleaned = raw.replace(/[₦,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return amount >= MIN_WITHDRAWAL && amount <= 1_000_000_000 ? amount : null;
}

/* ---------------- the verified account ---------------- */

interface VerifiedAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string | null;
  /** where EduPay emails the codes */
  email: string | null;
}

async function verifiedAccount(organizationId: string): Promise<VerifiedAccount | null> {
  const row = await prisma.merchantPaymentAccount.findUnique({
    where: { organizationId },
    select: {
      verificationStatus: true,
      settlementBankCode: true,
      settlementBankName: true,
      settlementAccountNumber: true,
      settlementAccountName: true,
      contactEmail: true,
    },
  });
  if (row?.verificationStatus !== 'VERIFIED' || !row.settlementBankCode || !row.settlementBankName || !row.settlementAccountNumber) return null;
  return {
    bankCode: row.settlementBankCode,
    bankName: row.settlementBankName,
    accountNumber: row.settlementAccountNumber,
    accountName: row.settlementAccountName,
    email: row.contactEmail,
  };
}

/** EduPay's id for the verified account: null when not added yet, 'unavailable' when EduPay can't be asked. */
async function linkedAccountId(ids: WalletIds, account: VerifiedAccount): Promise<number | null | 'unavailable'> {
  const accounts = await getBankAccounts(ids);
  if (!accounts) return 'unavailable';
  return (
    accounts.find((a) => a.active && a.accountNumber === account.accountNumber && (a.bankCode === null || a.bankCode === account.bankCode))?.id ?? null
  );
}

/* ---------------- the page's view ---------------- */

export interface WithdrawalRow {
  id: string;
  status: 'AWAITING_CODE' | 'CONFIRMING' | 'SENT' | 'RETURNED' | 'FAILED' | 'EXPIRED';
  amount: number;
  bankName: string;
  accountNumber: string;
  createdAt: string;
}

export interface PayoutView {
  account: { bankName: string; accountNumber: string; accountName: string | null } | null;
  email: string | null;
  linked: boolean;
  /** EduPay couldn't be asked: nothing may start until it can */
  reachable: boolean;
  auto: AutoWithdrawSettings | null;
  /** auto-withdraw is paying an account other than the verified one (set outside this page) */
  autoElsewhere: boolean;
  open: WithdrawalRow | null;
  recent: WithdrawalRow[];
  runs: AutoWithdrawRun[] | null;
}

const toRow = (w: { id: string; status: WithdrawalRow['status']; amount: { toString(): string }; bankName: string; accountNumber: string; createdAt: Date }): WithdrawalRow => ({
  id: w.id,
  status: w.status,
  amount: Number(w.amount.toString()),
  bankName: w.bankName,
  accountNumber: w.accountNumber,
  createdAt: w.createdAt.toISOString(),
});

export async function payoutView(organizationId: string, now = new Date()): Promise<PayoutView | null> {
  const ids = await activeShopWalletIds(organizationId);
  if (!ids) return null;
  await settleWithdrawals({ organizationId, now });

  const account = await verifiedAccount(organizationId);
  const [linked, auto, runs, rows] = await Promise.all([
    account ? linkedAccountId(ids, account) : Promise.resolve(null),
    getAutoWithdraw(ids),
    getAutoWithdrawHistory(ids),
    prisma.walletWithdrawal.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  const linkedId = linked === 'unavailable' ? null : linked;
  const recent = rows.map(toRow);
  return {
    account: account && { bankName: account.bankName, accountNumber: account.accountNumber, accountName: account.accountName },
    email: account?.email ?? null,
    linked: linkedId !== null,
    reachable: linked !== 'unavailable' && auto !== null,
    auto,
    autoElsewhere: Boolean(auto?.enabled && linkedId !== null && auto.bankAccountId !== linkedId),
    open: recent.find((r) => r.status === 'AWAITING_CODE' || r.status === 'CONFIRMING') ?? null,
    recent,
    runs,
  };
}

/* ---------------- adding the account ---------------- */

export type PayoutResult<T = void> = { ok: true; data: T } | { ok: false; error: string; field?: 'amount' | 'code' };

const UNREACHABLE = 'We couldn’t reach EduPay just now. Nothing has changed — please try again in a minute.';
const NO_ACCOUNT = 'Your shop doesn’t have a verified bank account yet. It comes from your online payments application.';
const NO_WALLET = 'Your shop wallet isn’t ready yet.';

/** Step one: EduPay emails a code to the wallet's address. The account is ours, not the browser's. */
export async function startBankLink(organizationId: string): Promise<PayoutResult> {
  const ids = await activeShopWalletIds(organizationId);
  if (!ids) return { ok: false, error: NO_WALLET };
  const account = await verifiedAccount(organizationId);
  if (!account) return { ok: false, error: NO_ACCOUNT };
  const linked = await linkedAccountId(ids, account);
  if (linked === 'unavailable') return { ok: false, error: UNREACHABLE };
  if (linked !== null) return { ok: false, error: 'This account is already connected.' };

  const asked = await requestAddBankAccount(ids, { accountNumber: account.accountNumber, bankCode: account.bankCode, bankName: account.bankName });
  if (asked.kind === 'code-sent') return { ok: true, data: undefined };
  if (asked.kind === 'unavailable') return { ok: false, error: UNREACHABLE };
  return { ok: false, error: asked.reason === 'code-not-sent' ? 'EduPay couldn’t send the code. Please try again.' : 'EduPay couldn’t add this account. Please contact support.' };
}

export async function confirmBankLink(organizationId: string, code: string): Promise<PayoutResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Enter the 6-digit code from the email.', field: 'code' };
  const ids = await activeShopWalletIds(organizationId);
  if (!ids) return { ok: false, error: NO_WALLET };
  const account = await verifiedAccount(organizationId);
  if (!account) return { ok: false, error: NO_ACCOUNT };

  const answer = await confirmAddBankAccount(ids, code);
  switch (answer.kind) {
    case 'done':
      return { ok: true, data: undefined };
    case 'wrong-code':
      return { ok: false, error: 'That code isn’t right. Please check the email and try again.', field: 'code' };
    case 'expired':
      return { ok: false, error: 'That code has expired. Please start again.' };
    case 'refused':
      return { ok: false, error: 'EduPay couldn’t add this account. Please contact support.' };
    case 'unknown': {
      // Adding an account moves no money, so simply look.
      const linked = await linkedAccountId(ids, account);
      return typeof linked === 'number' ? { ok: true, data: undefined } : { ok: false, error: UNREACHABLE };
    }
  }
}

/* ---------------- withdrawing by hand ---------------- */

export async function startWithdrawal(input: { organizationId: string; rawAmount: string; performedById: string }): Promise<PayoutResult<{ id: string; amount: number }>> {
  const amount = parseWithdrawalAmount(input.rawAmount);
  if (amount === null) return { ok: false, field: 'amount', error: `Enter a whole amount of at least ${formatMoney(MIN_WITHDRAWAL)}.` };

  const { organizationId } = input;
  const ids = await activeShopWalletIds(organizationId);
  if (!ids) return { ok: false, error: NO_WALLET };
  const account = await verifiedAccount(organizationId);
  if (!account) return { ok: false, error: NO_ACCOUNT };
  await settleWithdrawals({ organizationId });

  const [linked, auto, wallet] = await Promise.all([linkedAccountId(ids, account), getAutoWithdraw(ids), getWallet(ids)]);
  if (linked === 'unavailable' || !auto || !wallet) return { ok: false, error: UNREACHABLE };
  if (linked === null) return { ok: false, error: 'Connect your bank account first.' };
  if (auto.enabled) return { ok: false, error: 'Auto-withdraw is on, so withdrawals happen on its schedule. Turn it off to withdraw now.' };
  if (wallet.balanceKobo < amount * 100) {
    return { ok: false, field: 'amount', error: `The wallet has ${formatMoney(wallet.balanceKobo / 100, wallet.currency)} — not enough for this withdrawal.` };
  }

  const reference = `WD-${randomBytes(5).toString('hex').toUpperCase()}`;
  const row = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} FOR UPDATE`;
    const open = await tx.walletWithdrawal.count({ where: { organizationId, status: { in: ['AWAITING_CODE', 'CONFIRMING'] } } });
    if (open > 0) return null;
    return tx.walletWithdrawal.create({
      data: {
        organizationId,
        reference,
        amount,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        requestedById: input.performedById,
      },
      select: { id: true },
    });
  });
  if (!row) return { ok: false, error: 'A withdrawal is already in progress. Finish or cancel it first.' };

  const asked = await requestWithdraw(ids, { amount, accountId: linked, description: `Withdrawal to ${account.bankName} (${reference})` });
  if (asked.kind === 'code-sent') return { ok: true, data: { id: row.id, amount } };

  // Only a code was being asked for, so nothing has moved.
  await prisma.walletWithdrawal.update({
    where: { id: row.id },
    data: { status: 'FAILED', settledAt: new Date(), lastError: asked.kind === 'refused' ? (asked.message ?? asked.reason) : 'EduPay unreachable' },
  });
  if (asked.kind === 'unavailable') return { ok: false, error: UNREACHABLE };
  switch (asked.reason) {
    case 'too-low':
      return { ok: false, field: 'amount', error: `The smallest withdrawal is ${formatMoney(MIN_WITHDRAWAL)}.` };
    case 'insufficient':
      return { ok: false, field: 'amount', error: 'There isn’t enough in the wallet for this withdrawal.' };
    case 'account-gone':
      return { ok: false, error: 'EduPay can’t find your bank account any more. Please connect it again.' };
    case 'code-not-sent':
      return { ok: false, error: 'EduPay couldn’t send the code. Nothing has moved — please try again.' };
    case 'rejected':
      return { ok: false, error: 'EduPay couldn’t start this withdrawal. Nothing has moved.' };
  }
}

export type ConfirmOutcome = 'sent' | 'checking';

export async function confirmWithdrawal(input: { organizationId: string; code: string; performedById: string; now?: Date }): Promise<PayoutResult<ConfirmOutcome>> {
  if (!/^\d{6}$/.test(input.code)) return { ok: false, error: 'Enter the 6-digit code from the email.', field: 'code' };
  const now = input.now ?? new Date();
  const { organizationId } = input;
  const row = await prisma.walletWithdrawal.findFirst({ where: { organizationId, status: 'AWAITING_CODE' }, orderBy: { createdAt: 'desc' } });
  if (!row) return { ok: false, error: 'There’s no withdrawal waiting for a code. Please start again.' };

  const expire = (lastError: string) =>
    prisma.walletWithdrawal.updateMany({ where: { id: row.id, status: 'AWAITING_CODE' }, data: { status: 'EXPIRED', settledAt: now, lastError } });
  if (now.getTime() - row.createdAt.getTime() > CODE_LIFETIME_MS) {
    await expire('The code was never used');
    return { ok: false, error: 'That code has expired. Please start again.' };
  }

  const ids = await activeShopWalletIds(organizationId);
  if (!ids) return { ok: false, error: NO_WALLET };
  const auto = await getAutoWithdraw(ids);
  if (!auto) return { ok: false, error: UNREACHABLE };
  if (auto.enabled) {
    await expire('Auto-withdraw was turned on');
    return { ok: false, error: 'Auto-withdraw is now on, so this withdrawal was cancelled. Nothing has moved.' };
  }

  const claimed = await prisma.walletWithdrawal.updateMany({
    where: { id: row.id, status: 'AWAITING_CODE' },
    data: { status: 'CONFIRMING', confirmedById: input.performedById },
  });
  if (!claimed.count) return { ok: false, error: 'This withdrawal has already been confirmed.' };

  const answer = await confirmWithdraw(ids, input.code);
  switch (answer.kind) {
    case 'done':
      await prisma.walletWithdrawal.update({ where: { id: row.id }, data: { status: 'SENT', gatewayRef: answer.reference, settledAt: now, lastError: null } });
      return { ok: true, data: 'sent' };
    case 'wrong-code':
      await prisma.walletWithdrawal.update({ where: { id: row.id }, data: { status: 'AWAITING_CODE' } });
      return { ok: false, error: 'That code isn’t right. Please check the email and try again.', field: 'code' };
    case 'expired':
      await prisma.walletWithdrawal.update({ where: { id: row.id }, data: { status: 'EXPIRED', settledAt: now, lastError: 'EduPay says the code expired' } });
      return { ok: false, error: 'That code has expired. Please start again.' };
    case 'refused':
      await prisma.walletWithdrawal.update({ where: { id: row.id }, data: { status: 'FAILED', settledAt: now, lastError: answer.message ?? 'Refused by EduPay' } });
      return { ok: false, error: 'EduPay couldn’t complete this withdrawal. Nothing has moved.' };
    case 'unknown':
      console.error(`[wallet] ${row.reference}: confirm_withdraw unanswered (${answer.reason}) — left to settle from the wallet's transactions`);
      await prisma.walletWithdrawal.update({ where: { id: row.id }, data: { lastError: `No clear answer from EduPay (${answer.reason})` } });
      return { ok: true, data: 'checking' };
  }
}

/** Forget a withdrawal still waiting for its code. Nothing has moved, and our side will no longer confirm it. */
export async function cancelWithdrawal(organizationId: string, now = new Date()): Promise<PayoutResult> {
  const { count } = await prisma.walletWithdrawal.updateMany({
    where: { organizationId, status: 'AWAITING_CODE' },
    data: { status: 'EXPIRED', settledAt: now, lastError: 'Cancelled' },
  });
  return count ? { ok: true, data: undefined } : { ok: false, error: 'There’s no withdrawal waiting for a code.' };
}

/* ---------------- auto-withdraw ---------------- */

export type AutoWithdrawInput = Omit<AutoWithdrawSettings, 'bankAccountId'>;

/** Always the verified account: which account it pays is never the browser's to say. */
export async function saveAutoWithdraw(organizationId: string, input: AutoWithdrawInput): Promise<PayoutResult> {
  const ids = await activeShopWalletIds(organizationId);
  if (!ids) return { ok: false, error: NO_WALLET };
  const account = await verifiedAccount(organizationId);
  if (input.enabled && !account) return { ok: false, error: NO_ACCOUNT };
  const [linked, current] = await Promise.all([account ? linkedAccountId(ids, account) : Promise.resolve(null), getAutoWithdraw(ids)]);
  if (linked === 'unavailable' || !current) return { ok: false, error: UNREACHABLE };
  if (input.enabled && linked === null) return { ok: false, error: 'Connect your bank account first.' };
  if (input.enabled) {
    const open = await prisma.walletWithdrawal.count({ where: { organizationId, status: { in: ['AWAITING_CODE', 'CONFIRMING'] } } });
    if (open) return { ok: false, error: 'A withdrawal is in progress. Finish or cancel it before turning on auto-withdraw.' };
  }
  const saved = await updateAutoWithdraw(ids, { ...input, bankAccountId: linked ?? current.bankAccountId });
  if (saved.ok) return { ok: true, data: undefined };
  return { ok: false, error: saved.unavailable ? UNREACHABLE : (saved.message ?? 'EduPay couldn’t save these settings.') };
}

/* ---------------- settling ---------------- */

/**
 * Bring open withdrawals in line with the wallet's transactions: dead codes
 * expire, unanswered confirmations resolve, and a sent one whose money came
 * back is RETURNED, with the Owner told. Never while EduPay can't be asked.
 * Run from the wallet page, before a new withdrawal, and by the `wallet-setup` job.
 */
export async function settleWithdrawals({ organizationId, limit = 50, now = new Date() }: { organizationId?: string; limit?: number; now?: Date } = {}) {
  const scope = organizationId ? { organizationId } : {};
  const { count: expired } = await prisma.walletWithdrawal.updateMany({
    where: { ...scope, status: 'AWAITING_CODE', createdAt: { lt: new Date(now.getTime() - CODE_LIFETIME_MS) } },
    data: { status: 'EXPIRED', settledAt: now, lastError: 'The code was never used' },
  });

  const rows = await prisma.walletWithdrawal.findMany({
    where: {
      ...scope,
      OR: [
        // A minute's grace: a confirmation may still be waiting for its answer.
        { status: 'CONFIRMING', updatedAt: { lt: new Date(now.getTime() - 60_000) } },
        { status: 'SENT', createdAt: { gt: new Date(now.getTime() - WATCH_SENT_MS) } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, organizationId: true, reference: true, status: true, amount: true, createdAt: true },
  });

  const counts = { checked: rows.length, expired, returned: 0 };
  for (const row of rows) {
    const ids = await activeShopWalletIds(row.organizationId);
    if (!ids) continue;
    const found = await withdrawalState(ids, row.reference);
    if (found === 'unavailable') continue;

    const move = (status: 'SENT' | 'RETURNED' | 'FAILED', lastError: string | null, gatewayRef?: string | null) =>
      prisma.walletWithdrawal.updateMany({
        where: { id: row.id, status: row.status },
        data: { status, lastError, settledAt: now, ...(gatewayRef ? { gatewayRef } : {}) },
      });

    if (found === 'not-found') {
      if (row.status === 'CONFIRMING' && now.getTime() - row.createdAt.getTime() > UNANSWERED_MS) {
        await move('FAILED', 'EduPay has no record of it — nothing moved');
      }
      continue;
    }
    if (found.state === 'returned' || (found.state === 'failed' && row.status === 'SENT')) {
      const { count } = await move('RETURNED', 'The bank transfer failed, and EduPay put the money back');
      if (count) {
        counts.returned += 1;
        await listOwnerNotice(
          row.organizationId,
          {
            heading: 'A withdrawal came back to your wallet',
            paragraphs: [`The bank transfer for ${formatMoney(Number(row.amount))} didn’t go through, so EduPay put the money back in your shop wallet.`],
          },
          '/settings/payments/wallet',
          `withdrawal-returned:${row.id}`,
        );
      }
    } else if (row.status === 'CONFIRMING') {
      if (found.state === 'failed') await move('FAILED', 'EduPay reports the withdrawal failed');
      else await move('SENT', null, found.reference);
    }
  }
  return counts;
}
