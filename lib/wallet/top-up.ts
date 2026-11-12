/*
 * lib/wallet/top-up.ts
 *
 * Adding money to a shopper's or a shop's wallet with Paystack, through
 * EduPay (ROADMAP 20.3). Server only.
 *
 * THE FLOW. We ask EduPay to start a payment (`initiate_fund_wallet`); it
 * answers with its charges and a Paystack access code, which the browser
 * opens in Paystack's own window ON OUR PAGE — no redirect. Paystack takes
 * the money into EduPay's account and EduPay's webhook credits the wallet.
 * We then ask EduPay whether it landed; a top-up is COMPLETED only on
 * EduPay's word, never on the browser's "success" callback.
 *
 * NOBODY WAITING. Someone who closes the tab after paying still gets their
 * money — EduPay credits it regardless — and the `wallet-setup` job settles
 * our record so the page stops saying "adding…".
 *
 * WHO PAYS THE CHARGES. Whoever tops up, on top of the amount: EduPay's
 * reply names them, and the page shows amount + charges = total before the
 * payment window opens.
 */
import { prisma } from '@/lib/prisma';
import { fundingState, initiateFunding, walletEnvironment, type WalletIds } from './edupay';
import { activeShopperWalletIds } from './shopper';
import { activeShopWalletIds } from './shop';

/** Naira. EduPay may refuse inside these, and then says why. */
export const MIN_TOP_UP = 100;
export const MAX_TOP_UP = 1_000_000;
/** EduPay's payment stays payable this long if it names no expiry. */
const DEFAULT_LIFETIME_MS = 24 * 60 * 60_000;
/** After expiry, how long a payment may still turn up (a late webhook). */
const LATE_GRACE_MS = 60 * 60_000;

export type TopUpOwner =
  | { kind: 'SHOPPER'; organizationId: string; customerId: string }
  | { kind: 'SHOP'; organizationId: string; startedById: string };

/** Whole naira between the limits, typed with or without commas. Null when it isn't one. */
export function parseTopUpAmount(raw: string): number | null {
  const cleaned = raw.replace(/[₦,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return amount >= MIN_TOP_UP && amount <= MAX_TOP_UP ? amount : null;
}

function walletIdsFor(owner: TopUpOwner): Promise<WalletIds | null> {
  return owner.kind === 'SHOPPER' ? activeShopperWalletIds(owner.customerId) : activeShopWalletIds(owner.organizationId);
}

export type StartResult =
  | { ok: true; topUpId: string; accessCode: string; amount: number; fee: number; total: number }
  | { ok: false; reason: 'no-wallet' | 'unavailable' | 'rejected' };

export async function startTopUp(owner: TopUpOwner, amount: number): Promise<StartResult> {
  const ids = await walletIdsFor(owner);
  const environment = walletEnvironment();
  if (!ids || !environment) return { ok: false, reason: 'no-wallet' };

  const started = await initiateFunding(ids, {
    amount,
    description: owner.kind === 'SHOP' ? 'Shop wallet top-up' : 'Wallet top-up',
    metadata: { source: 'notely', wallet: owner.kind === 'SHOP' ? 'shop' : 'shopper' },
  });
  if (started.kind === 'unavailable') return { ok: false, reason: 'unavailable' };
  if (started.kind === 'rejected') {
    console.warn('[wallet] EduPay refused a top-up');
    return { ok: false, reason: 'rejected' };
  }

  const row = await prisma.walletTopUp.create({
    data: {
      organizationId: owner.organizationId,
      kind: owner.kind,
      customerId: owner.kind === 'SHOPPER' ? owner.customerId : null,
      startedById: owner.kind === 'SHOP' ? owner.startedById : null,
      reference: started.reference,
      amount: started.amount,
      fee: started.fee,
      total: started.total,
      environment,
      expiresAt: started.expiresAt ? new Date(started.expiresAt) : new Date(Date.now() + DEFAULT_LIFETIME_MS),
    },
    select: { id: true },
  });
  return { ok: true, topUpId: row.id, accessCode: started.accessCode, amount: started.amount, fee: started.fee, total: started.total };
}

/* ---------------- has it landed? ---------------- */

export type TopUpStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

/**
 * Ask EduPay about one of this owner's top-ups and record the answer. The
 * owner scopes the lookup — a top-up id from the browser is only ever used
 * together with whose it must be. Safe to call repeatedly: a settled top-up
 * is returned as it is, and the change to COMPLETED is conditional, so two
 * checks at once record it once.
 */
export async function checkTopUp(
  owner: TopUpOwner,
  topUpId: string,
  { now = new Date(), reportedPaid = false }: { now?: Date; reportedPaid?: boolean } = {},
): Promise<{ status: TopUpStatus; amount: number } | null> {
  const row = await prisma.walletTopUp.findFirst({
    where: {
      id: topUpId,
      organizationId: owner.organizationId,
      kind: owner.kind,
      ...(owner.kind === 'SHOPPER' ? { customerId: owner.customerId } : {}),
    },
  });
  if (!row) return null;
  const amount = Number(row.amount);
  if (row.status !== 'PENDING') return { status: row.status, amount };
  if (reportedPaid && !row.reportedPaidAt) {
    await prisma.walletTopUp.update({ where: { id: row.id }, data: { reportedPaidAt: now } });
    row.reportedPaidAt = now; // judged below with what was just recorded
  }

  const status = await settle(row, owner, now);
  return { status, amount };
}

async function settle(
  row: { id: string; reference: string; environment: string; expiresAt: Date | null; reportedPaidAt: Date | null },
  owner: TopUpOwner,
  now: Date,
): Promise<TopUpStatus> {
  const record = async (status: TopUpStatus, lastError: string | null) => {
    await prisma.walletTopUp.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status, lastError, checkedAt: now, ...(status === 'COMPLETED' ? { completedAt: now } : {}) },
    });
    return status;
  };

  if (row.environment !== walletEnvironment()) return record('FAILED', 'Started in another EduPay mode');
  const ids = await walletIdsFor(owner);
  if (!ids) {
    await prisma.walletTopUp.update({ where: { id: row.id }, data: { checkedAt: now, lastError: 'Wallet not active' } });
    return 'PENDING';
  }

  const state = await fundingState(ids, row.reference);
  if (state === 'completed') return record('COMPLETED', null);
  if (state === 'failed') return record('FAILED', 'EduPay reports the payment failed');

  const lapsed = row.expiresAt !== null && now.getTime() > row.expiresAt.getTime() + LATE_GRACE_MS;
  // Lapsed and never reported paid: a window closed without paying.
  if (lapsed && state !== 'unavailable' && !row.reportedPaidAt) {
    return record('EXPIRED', 'Not paid before EduPay’s payment expired');
  }
  // Lapsed but Paystack told the payer it was paid: never call that
  // "expired" — EduPay may well have credited it under a reference we
  // didn't recognise. It stays waiting, flagged for staff to check with EduPay.
  await prisma.walletTopUp.update({
    where: { id: row.id },
    data: {
      checkedAt: now,
      lastError:
        state === 'unavailable'
          ? 'EduPay unreachable'
          : lapsed
            ? 'Paystack said paid, but EduPay hasn’t confirmed it — check with EduPay'
            : null,
    },
  });
  return 'PENDING';
}

/**
 * The top-up half of the `wallet-setup` job: pending top-ups nobody stayed
 * to see through.
 */
export async function settlePendingTopUps({ limit = 50, now = new Date() }: { limit?: number; now?: Date } = {}) {
  const rows = await prisma.walletTopUp.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: new Date(now.getTime() - 60_000) },
      // Every 5 minutes once the payer said they paid (hourly once EduPay's
      // expiry is a day gone — those are flagged for staff); every 30
      // otherwise — most are windows closed without paying, waiting to lapse.
      OR: [
        { checkedAt: null },
        {
          reportedPaidAt: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) } }],
          checkedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
        },
        {
          reportedPaidAt: { not: null },
          expiresAt: { lte: new Date(now.getTime() - 24 * 60 * 60_000) },
          checkedAt: { lt: new Date(now.getTime() - 60 * 60_000) },
        },
        { reportedPaidAt: null, checkedAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, reference: true, environment: true, expiresAt: true, reportedPaidAt: true, kind: true, organizationId: true, customerId: true, startedById: true },
  });
  const counts = { checked: rows.length, completed: 0, failed: 0 };
  for (const row of rows) {
    const owner: TopUpOwner =
      row.kind === 'SHOPPER'
        ? { kind: 'SHOPPER', organizationId: row.organizationId, customerId: row.customerId ?? '' }
        : { kind: 'SHOP', organizationId: row.organizationId, startedById: row.startedById ?? '' };
    const status = await settle(row, owner, now);
    if (status === 'COMPLETED') counts.completed += 1;
    else if (status === 'FAILED' || status === 'EXPIRED') counts.failed += 1;
  }
  return counts;
}

/** Paid top-ups still waiting for EduPay's word, newest first — for "adding ₦1,500…" on the wallet pages. */
export async function pendingTopUps(owner: TopUpOwner) {
  const rows = await prisma.walletTopUp.findMany({
    where: {
      organizationId: owner.organizationId,
      kind: owner.kind,
      status: 'PENDING',
      reportedPaidAt: { not: null },
      ...(owner.kind === 'SHOPPER' ? { customerId: owner.customerId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, amount: true, createdAt: true },
  });
  return rows.map((r) => ({ id: r.id, amount: Number(r.amount), createdAt: r.createdAt.toISOString() }));
}
