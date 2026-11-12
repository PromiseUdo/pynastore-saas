/*
 * lib/wallet/shopper.ts
 *
 * A shopper account's EduPay wallet: made, or connected, once and without
 * the shopper doing anything (ROADMAP 20.2). Server only.
 *
 * WHEN. The wallet is asked for at the moments the shopper has just been
 * told their account includes one: proving their email after registering,
 * adding their phone after a Google sign-up, and opening the Wallet page
 * (which is how accounts made before wallets get theirs). Nothing is sent to
 * EduPay until the email is proved and there is a phone.
 *
 * TWO OUTCOMES, ONE RULE (./register.ts). EduPay creates a ₦0 wallet, or
 * says one already exists. An existing wallet is connected only when EduPay
 * matched it on the EMAIL and that email is the one this shopper proved to
 * us — EduPay verifies its own emails, so both sides have proved the same
 * inbox. A match on the phone is never connected: we don't verify phones, so
 * it may be a stranger's wallet. The shopper is asked to use another number.
 *
 * NEVER IN THE WAY. Setting up runs after the response (runAfter), and a
 * failure to reach EduPay is retried with backoff by the `wallet-setup` cron
 * job. Signing up never waits on EduPay.
 */
import { prisma } from '@/lib/prisma';
import { runAfter } from '@/lib/run-after';
import { toLocalNigerianPhone } from '@/lib/phone';
import {
  edupayConfigured,
  getTransactions,
  getPinStatus,
  getWallet,
  walletEnvironment,
  type PinStatus,
  type WalletSummary,
  type WalletTransaction,
} from './edupay';
import { MAX_ATTEMPTS, STALE_CLAIM_MS, decideRegistration, retryDelayMs } from './register';
import { retryDueShopWallets } from './shop';

export { generateUsername, retryDelayMs } from './register';

/** Unique at EduPay, and ours: one per shopper account. */
export const shopperUserRef = (customerId: string) => `shopper-${customerId}`;

interface Eligible {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  /** 0803… */
  phone: string;
}

/** The account, if it can have a wallet yet: active, email proved, a Nigerian mobile number. */
async function eligibleCustomer(customerId: string): Promise<Eligible | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true, organizationId: true, name: true, email: true, phone: true,
      status: true, emailVerifiedAt: true, accountDeletedAt: true, mergedIntoId: true,
    },
  });
  if (!customer || customer.status !== 'ACTIVE' || customer.accountDeletedAt || customer.mergedIntoId) return null;
  if (!customer.email || !customer.emailVerifiedAt) return null;
  const phone = customer.phone ? toLocalNigerianPhone(customer.phone) : null;
  if (!phone) return null;
  return { id: customer.id, organizationId: customer.organizationId, name: customer.name, email: customer.email, phone };
}

/* ---------------- asking for a wallet ---------------- */

/**
 * Make sure this account has a wallet, or is getting one: records the
 * request, and sets it up after the response. Does nothing for an account
 * that can't have one yet, or already has one.
 */
export async function requestShopperWallet(customerId: string): Promise<void> {
  if (await ensurePendingWallet(customerId)) runAfter(() => setUpShopperWallet(customerId));
}

/** Records the request; true when there is a pending wallet to set up. */
async function ensurePendingWallet(customerId: string): Promise<boolean> {
  if (!edupayConfigured()) return false;
  const customer = await eligibleCustomer(customerId);
  if (!customer) return false;

  const existing = await prisma.shopperWallet.findUnique({ where: { customerId }, select: { status: true, environment: true } });
  if (existing?.environment && existing.environment !== walletEnvironment()) {
    // Set up on another EduPay server (test, before go-live): start again here.
    await prisma.shopperWallet.update({
      where: { customerId },
      data: { status: 'PENDING', origin: null, edupayUuid: null, edupayUniqId: null, attempts: 0, nextAttemptAt: null, claimedAt: null, lastError: null, activatedAt: null, environment: null },
    });
    return true;
  }
  if (existing) return existing.status === 'PENDING';
  await prisma.shopperWallet
    .create({ data: { organizationId: customer.organizationId, customerId, userRef: shopperUserRef(customerId) } })
    // Two requests at once: the other one made the row, which is all we wanted.
    .catch(() => undefined);
  return true;
}

/**
 * The shopper changed their phone: a wallet held up because EduPay matched
 * the old number gets another try with the new one.
 */
export async function retryAfterPhoneChange(customerId: string): Promise<void> {
  await prisma.shopperWallet.updateMany({
    where: { customerId, status: 'PHONE_IN_USE' },
    data: { status: 'PENDING', nextAttemptAt: null, attempts: 0, lastError: null },
  });
  await requestShopperWallet(customerId);
}

/* ---------------- setting it up ---------------- */

export type SetUpOutcome = 'active' | 'phone-in-use' | 'failed' | 'retry-later' | 'skipped';

/**
 * One attempt at EduPay for this account's pending wallet. Claimed first
 * with a conditional update, so two requests (a page load and the cron job)
 * can't both register the same person.
 */
export async function setUpShopperWallet(customerId: string, now = new Date()): Promise<SetUpOutcome> {
  const claimed = await prisma.shopperWallet.updateMany({
    where: {
      customerId,
      status: 'PENDING',
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
      AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
    },
    data: { claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'skipped';

  const wallet = await prisma.shopperWallet.findUniqueOrThrow({ where: { customerId }, select: { id: true, userRef: true, attempts: true } });
  const customer = await eligibleCustomer(customerId);
  if (!customer) {
    // The account changed under us (closed, phone removed): wait for the next request.
    await prisma.shopperWallet.update({ where: { id: wallet.id }, data: { claimedAt: null, attempts: { decrement: 1 } } });
    return 'skipped';
  }

  const decision = await decideRegistration({
    userType: 'normal',
    userRef: wallet.userRef,
    fullName: customer.name,
    email: customer.email,
    phone: customer.phone,
    mayConnect: true,
  });

  const base = { claimedAt: null, environment: walletEnvironment() };
  const finish = (data: Parameters<typeof prisma.shopperWallet.update>[0]['data']) =>
    prisma.shopperWallet.update({ where: { id: wallet.id }, data: { ...base, ...data } });

  switch (decision.kind) {
    case 'active':
      await finish({
        status: 'ACTIVE', origin: decision.origin, edupayUuid: decision.uuid, edupayUniqId: decision.uniqId,
        activatedAt: now, lastError: null, nextAttemptAt: null,
      });
      return 'active';
    case 'phone-in-use':
      await finish({ status: 'PHONE_IN_USE', lastError: null, nextAttemptAt: null });
      return 'phone-in-use';
    case 'retry':
      if (wallet.attempts < MAX_ATTEMPTS) {
        await finish({ lastError: decision.error, nextAttemptAt: new Date(now.getTime() + retryDelayMs(wallet.attempts)) });
        return 'retry-later';
      }
      await finish({ status: 'FAILED', lastError: `${decision.error}, after ${wallet.attempts} attempts`, nextAttemptAt: null });
      return 'failed';
    case 'failed':
      await finish({ status: 'FAILED', lastError: decision.error, nextAttemptAt: null });
      return 'failed';
  }
}

/** The `wallet-setup` cron job: pending shopper and shop wallets whose next try is due. */
export async function retryDueWallets({ limit = 50, now = new Date() }: { limit?: number; now?: Date } = {}) {
  const counts = { due: 0, active: 0, waiting: 0, failed: 0 };
  if (!edupayConfigured()) return counts;
  const due = await prisma.shopperWallet.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }] }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { customerId: true },
  });
  counts.due = due.length;
  for (const { customerId } of due) {
    const outcome = await setUpShopperWallet(customerId, now);
    if (outcome === 'active') counts.active += 1;
    else if (outcome === 'failed' || outcome === 'phone-in-use') counts.failed += 1;
    else counts.waiting += 1;
  }

  const shops = await retryDueShopWallets({ limit, now });
  return {
    due: counts.due + shops.due,
    active: counts.active + shops.active,
    waiting: counts.waiting + shops.waiting,
    failed: counts.failed + shops.failed,
  };
}

/* ---------------- what the Wallet page shows ---------------- */

export type ShopperWalletView =
  | { state: 'unavailable' } // wallets aren't switched on here
  | { state: 'setting-up' }
  | { state: 'phone-in-use' }
  | { state: 'problem' }
  | {
      state: 'active';
      origin: 'CREATED' | 'CONNECTED' | null;
      wallet: WalletSummary | null;
      transactions: WalletTransaction[] | null;
      /** null: EduPay didn't answer */
      pin: PinStatus | null;
    };

/**
 * Everything the shopper's Wallet page needs. Opening it is also how an
 * account made before wallets gets one (the page says so). Balance and
 * transactions come from EduPay on every load; null means EduPay didn't
 * answer just now.
 */
export async function shopperWalletView(customerId: string): Promise<ShopperWalletView> {
  if (!edupayConfigured()) return { state: 'unavailable' };

  let row = await prisma.shopperWallet.findUnique({ where: { customerId } });
  if (!row || row.status === 'PENDING' || (row.environment && row.environment !== walletEnvironment())) {
    // Here the shopper is looking at the page, so try now rather than after.
    if (await ensurePendingWallet(customerId)) await setUpShopperWallet(customerId);
    row = await prisma.shopperWallet.findUnique({ where: { customerId } });
  }
  if (!row || row.status === 'PENDING') return { state: 'setting-up' };
  if (row.status === 'PHONE_IN_USE') return { state: 'phone-in-use' };
  if (row.status === 'FAILED' || !row.edupayUuid || !row.edupayUniqId) return { state: 'problem' };

  const ids = { uuid: row.edupayUuid, uniqId: row.edupayUniqId };
  const [wallet, transactions, pin] = await Promise.all([getWallet(ids), getTransactions(ids, { limit: 10 }), getPinStatus(ids)]);
  return { state: 'active', origin: row.origin, wallet, transactions: transactions?.items ?? null, pin };
}

/** The ids of this account's wallet, when it is active on the current EduPay server. */
export async function activeShopperWalletIds(customerId: string): Promise<{ uuid: string; uniqId: string } | null> {
  if (!edupayConfigured()) return null;
  const row = await prisma.shopperWallet.findUnique({ where: { customerId } });
  if (!row || row.status !== 'ACTIVE' || !row.edupayUuid || !row.edupayUniqId) return null;
  if (row.environment && row.environment !== walletEnvironment()) return null;
  return { uuid: row.edupayUuid, uniqId: row.edupayUniqId };
}
