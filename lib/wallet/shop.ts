/*
 * lib/wallet/shop.ts
 *
 * A shop's EduPay wallet (ROADMAP 20.4). Server only.
 *
 * WHEN. When platform staff approve the shop for online payments — the
 * moment its Paystack subaccount is made too — and from then on whenever
 * someone opens the shop's wallet page, which is how shops approved before
 * wallets get theirs. Nothing is sent before approval: every business check
 * is ours (Settings → Payments, 10.2), and the wallet is the reward for
 * passing them, not a step before.
 *
 * WHOSE DETAILS. The contact name, email and phone from the online-payments
 * application, which staff reviewed. A new one is a `business` wallet.
 *
 * ONE WALLET PER PERSON (EduPay, 2026-10-30). EduPay won't give an email a
 * second wallet of the other type, so when the contact email already has
 * one — the owner's own, made as a shopper or on EduPay — the shop uses
 * THAT wallet, and the owner reaches the same money as shopper and vendor.
 * Only when the contact email is one a shop Owner proved to us: a typed
 * contact email must never send a shop's takings to a stranger's wallet.
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

/** Unique at EduPay, and ours: one per shop. */
export const shopUserRef = (organizationId: string) => `shop-${organizationId}`;

interface EligibleShop {
  organizationId: string;
  name: string;
  email: string;
  /** 0803… */
  phone: string;
  /** The contact email is an active Owner's, proved at sign-up — so it may be connected to their existing wallet. */
  ownerEmail: boolean;
}

/** The shop, if it can have a wallet: open, approved for online payments, with a contact email and Nigerian mobile. */
async function eligibleShop(organizationId: string): Promise<EligibleShop | null> {
  const account = await prisma.merchantPaymentAccount.findUnique({
    where: { organizationId },
    select: {
      verificationStatus: true, businessName: true, registeredName: true, contactEmail: true, contactPhone: true,
      organization: { select: { name: true, status: true } },
    },
  });
  if (!account || account.verificationStatus !== 'VERIFIED' || account.organization.status !== 'ACTIVE') return null;
  const phone = account.contactPhone ? toLocalNigerianPhone(account.contactPhone) : null;
  if (!account.contactEmail || !phone) return null;
  const owner = await prisma.membership.findFirst({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: { isSystem: true, name: 'Owner' },
      user: { email: { equals: account.contactEmail.trim(), mode: 'insensitive' }, emailVerified: { not: null } },
    },
    select: { id: true },
  });
  return {
    organizationId,
    name: account.businessName?.trim() || account.registeredName?.trim() || account.organization.name,
    email: account.contactEmail,
    phone,
    ownerEmail: owner !== null,
  };
}

/* ---------------- asking for a wallet ---------------- */

/** After approval: record the request and set it up once the response has gone. */
export async function requestShopWallet(organizationId: string): Promise<void> {
  if (await ensurePendingShopWallet(organizationId)) runAfter(() => setUpShopWallet(organizationId));
}

async function ensurePendingShopWallet(organizationId: string): Promise<boolean> {
  if (!edupayConfigured()) return false;
  if (!(await eligibleShop(organizationId))) return false;

  const existing = await prisma.shopWallet.findUnique({ where: { organizationId }, select: { status: true, environment: true } });
  if (existing?.environment && existing.environment !== walletEnvironment()) {
    // Set up on another EduPay server (test, before go-live): start again here.
    await prisma.shopWallet.update({
      where: { organizationId },
      data: { status: 'PENDING', origin: null, edupayUuid: null, edupayUniqId: null, attempts: 0, nextAttemptAt: null, claimedAt: null, lastError: null, activatedAt: null, environment: null },
    });
    return true;
  }
  if (existing) return existing.status === 'PENDING';
  await prisma.shopWallet.create({ data: { organizationId, userRef: shopUserRef(organizationId) } }).catch(() => undefined);
  return true;
}

/* ---------------- setting it up ---------------- */

export type ShopSetUpOutcome = 'active' | 'failed' | 'retry-later' | 'skipped';

/** One claimed attempt at EduPay for this shop's pending wallet. */
export async function setUpShopWallet(organizationId: string, now = new Date()): Promise<ShopSetUpOutcome> {
  const claimed = await prisma.shopWallet.updateMany({
    where: {
      organizationId,
      status: 'PENDING',
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
      AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
    },
    data: { claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'skipped';

  const wallet = await prisma.shopWallet.findUniqueOrThrow({ where: { organizationId }, select: { id: true, userRef: true, attempts: true } });
  const shop = await eligibleShop(organizationId);
  if (!shop) {
    await prisma.shopWallet.update({ where: { id: wallet.id }, data: { claimedAt: null, attempts: { decrement: 1 } } });
    return 'skipped';
  }

  const decision = await decideRegistration({
    userType: 'business',
    userRef: wallet.userRef,
    fullName: shop.name,
    email: shop.email,
    phone: shop.phone,
    mayConnect: shop.ownerEmail,
    usernameFallback: 'shop',
  });

  const base = { claimedAt: null, environment: walletEnvironment() };
  const finish = (data: Parameters<typeof prisma.shopWallet.update>[0]['data']) =>
    prisma.shopWallet.update({ where: { id: wallet.id }, data: { ...base, ...data } });

  switch (decision.kind) {
    case 'active':
      await finish({ status: 'ACTIVE', origin: decision.origin, edupayUuid: decision.uuid, edupayUniqId: decision.uniqId, activatedAt: now, lastError: null, nextAttemptAt: null });
      return 'active';
    case 'retry':
      if (wallet.attempts < MAX_ATTEMPTS) {
        await finish({ lastError: decision.error, nextAttemptAt: new Date(now.getTime() + retryDelayMs(wallet.attempts)) });
        return 'retry-later';
      }
      await finish({ status: 'FAILED', lastError: `${decision.error}, after ${wallet.attempts} attempts`, nextAttemptAt: null });
      return 'failed';
    case 'phone-in-use': // can't happen for a business wallet; treated as the refusal it would be
    case 'failed':
      await finish({ status: 'FAILED', lastError: decision.kind === 'failed' ? decision.error : 'EduPay matched the phone', nextAttemptAt: null });
      return 'failed';
  }
}

/** The shop half of the `wallet-setup` cron job (./shopper.ts retryDueWallets). */
export async function retryDueShopWallets({ limit = 50, now = new Date() }: { limit?: number; now?: Date } = {}) {
  const due = await prisma.shopWallet.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }] }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { organizationId: true },
  });
  const counts = { due: due.length, active: 0, waiting: 0, failed: 0 };
  for (const { organizationId } of due) {
    const outcome = await setUpShopWallet(organizationId, now);
    if (outcome === 'active') counts.active += 1;
    else if (outcome === 'failed') counts.failed += 1;
    else counts.waiting += 1;
  }
  return counts;
}

/* ---------------- what the admin shows ---------------- */

export type ShopWalletState = 'unavailable' | 'not-approved' | 'setting-up' | 'problem' | 'active';

/**
 * Where the shop's wallet stands, from our records alone — cheap enough for
 * the Payments settings card. Also asks for the wallet (after the response)
 * when an approved shop has none yet.
 */
export async function shopWalletState(organizationId: string): Promise<ShopWalletState> {
  if (!edupayConfigured()) return 'unavailable';
  if (!(await eligibleShop(organizationId))) return 'not-approved';
  await requestShopWallet(organizationId);
  const row = await prisma.shopWallet.findUnique({ where: { organizationId }, select: { status: true, edupayUuid: true } });
  if (!row || row.status === 'PENDING') return 'setting-up';
  if (row.status === 'ACTIVE' && row.edupayUuid) return 'active';
  return 'problem';
}

export type ShopWalletView =
  | { state: Exclude<ShopWalletState, 'active'> }
  | {
      state: 'active';
      /** CONNECTED: the Owner's own EduPay wallet, shared with their shopping. */
      origin: 'CREATED' | 'CONNECTED' | null;
      wallet: WalletSummary | null;
      transactions: WalletTransaction[] | null;
      total: number;
      pin: PinStatus | null;
    };

/**
 * The shop wallet page: tries the setup there and then if it's due (someone
 * is looking), and reads the balance and transactions from EduPay.
 */
export async function shopWalletView(
  organizationId: string,
  { limit = 25, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ShopWalletView> {
  if (!edupayConfigured()) return { state: 'unavailable' };
  if (!(await eligibleShop(organizationId))) return { state: 'not-approved' };

  if (await ensurePendingShopWallet(organizationId)) await setUpShopWallet(organizationId);
  const row = await prisma.shopWallet.findUnique({ where: { organizationId } });
  if (!row || row.status === 'PENDING') return { state: 'setting-up' };
  if (row.status !== 'ACTIVE' || !row.edupayUuid || !row.edupayUniqId) return { state: 'problem' };

  const ids = { uuid: row.edupayUuid, uniqId: row.edupayUniqId };
  const [wallet, transactions, pin] = await Promise.all([getWallet(ids), getTransactions(ids, { limit, offset }), getPinStatus(ids)]);
  return { state: 'active', origin: row.origin, wallet, transactions: transactions?.items ?? null, total: transactions?.total ?? 0, pin };
}

/** The ids of this shop's wallet, when it is active on the current EduPay server. */
export async function activeShopWalletIds(organizationId: string): Promise<{ uuid: string; uniqId: string } | null> {
  if (!edupayConfigured()) return null;
  const row = await prisma.shopWallet.findUnique({ where: { organizationId } });
  if (!row || row.status !== 'ACTIVE' || !row.edupayUuid || !row.edupayUniqId) return null;
  if (row.environment && row.environment !== walletEnvironment()) return null;
  return { uuid: row.edupayUuid, uniqId: row.edupayUniqId };
}
