/*
 * lib/payments/paystack.ts
 *
 * The one server-only client for the platform's Paystack integration. Never
 * import from a client component — it reads PAYSTACK_SECRET_KEY.
 *
 * Subscription billing (lib/billing/paystack.ts) and merchant payments
 * (ROADMAP Phase 10) talk to the same Paystack account, so they share this
 * request helper rather than keeping two. Merchants never supply a key: every
 * call here is made with the platform's.
 *
 * What was checked against Paystack's published API spec, and what wasn't, is
 * recorded in ROADMAP 10.13.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

/**
 * What's wrong with the Paystack configuration, in words — or null.
 *
 * The key decides test or live mode (`sk_test_…` / `sk_live_…`). A deployment
 * may also state which mode it expects in PAYSTACK_MODE (`live` in production).
 * When the two disagree, NOTHING talks to Paystack: a test key left on the
 * live site would let shoppers "pay" with test cards and have their orders
 * marked paid, and a live key on a test deployment would move real money.
 */
export function paystackConfigProblem(): string | null {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return 'PAYSTACK_SECRET_KEY is not configured.';
  const expected = process.env.PAYSTACK_MODE?.trim();
  if (!expected) return null;
  if (expected !== 'live' && expected !== 'test') return `PAYSTACK_MODE must be "live" or "test", not "${expected}".`;
  const actual = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unrecognised';
  if (actual !== expected) return `PAYSTACK_MODE is "${expected}" but PAYSTACK_SECRET_KEY is a ${actual} key.`;
  return null;
}

function secretKey(): string {
  const problem = paystackConfigProblem();
  if (problem) throw new PaystackError(problem, 0);
  return process.env.PAYSTACK_SECRET_KEY!;
}

export function isPaystackConfigured(): boolean {
  const problem = paystackConfigProblem();
  if (problem && process.env.PAYSTACK_SECRET_KEY) console.error(`[paystack] ${problem}`);
  return problem === null;
}

/**
 * One authenticated call. Returns Paystack's whole body (`{ status, message,
 * data, meta }`) and throws PaystackError — carrying the HTTP status, so a
 * caller can tell "no such account" from "Paystack is down" — on anything that
 * isn't a success.
 */
export async function paystackFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });

  let body: { status?: boolean; message?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    // An error page or an empty body — reported below with the status.
  }

  if (!res.ok || !body || body.status === false) {
    throw new PaystackError(body?.message ?? `Paystack request failed: ${path}`, res.status);
  }
  return body as T;
}

/* ---------------- banks ---------------- */

export interface PaystackBank {
  /** Paystack's own bank code — what a subaccount and /bank/resolve take */
  code: string;
  name: string;
}

type RawBank = {
  name?: string;
  code?: string;
  active?: boolean;
  is_deleted?: boolean;
  type?: string;
};

const BANKS_TTL_MS = 12 * 60 * 60 * 1000;
let bankCache: { at: number; banks: PaystackBank[] } | null = null;

/**
 * Nigerian banks Paystack can settle to, A–Z. The list changes rarely, so it
 * is kept for twelve hours per server instance rather than fetched on every
 * page view.
 */
export async function listNigerianBanks(): Promise<PaystackBank[]> {
  if (bankCache && Date.now() - bankCache.at < BANKS_TTL_MS) return bankCache.banks;

  const seen = new Map<string, PaystackBank>();
  let next: string | null = null;
  // Cursor pagination; the guard stops a misbehaving cursor looping forever.
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ country: 'nigeria', currency: 'NGN', perPage: '100', use_cursor: 'true' });
    if (next) query.set('next', next);
    const body: { data?: RawBank[]; meta?: { next?: string | null } } = await paystackFetch(`/bank?${query}`);

    for (const bank of body.data ?? []) {
      if (!bank.code || !bank.name || bank.active === false || bank.is_deleted) continue;
      if (bank.type && bank.type !== 'nuban') continue;
      if (!seen.has(bank.code)) seen.set(bank.code, { code: bank.code, name: bank.name.trim() });
    }
    next = body.meta?.next ?? null;
    if (!next) break;
  }

  const banks = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (banks.length > 0) bankCache = { at: Date.now(), banks };
  return banks;
}

/** For tests: forget the cached bank list. */
export function clearBankCache(): void {
  bankCache = null;
}

/**
 * The name the bank holds for an account, so a merchant confirms it rather
 * than types it. Returns null when Paystack says the account can't be
 * resolved (it answers 400/422). Throws on anything else — an outage or a key
 * problem is never shown to a merchant as "account not found".
 */
export async function resolveAccountName(bankCode: string, accountNumber: string): Promise<string | null> {
  try {
    const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
    const body: { data?: { account_name?: string } } = await paystackFetch(`/bank/resolve?${query}`);
    const name = body.data?.account_name?.trim();
    return name ? name : null;
  } catch (error) {
    if (error instanceof PaystackError && (error.httpStatus === 400 || error.httpStatus === 422)) return null;
    throw error;
  }
}

/** True with a `sk_test_` key: Paystack's test mode, where no real money moves. */
export function isPaystackTestMode(): boolean {
  return (process.env.PAYSTACK_SECRET_KEY ?? '').startsWith('sk_test_');
}

/* ---------------- subaccounts ---------------- */

/*
 * Checked against Paystack in test mode on 2026-09-29 (ROADMAP 10.13):
 *   - `settlement_bank` takes Paystack's bank code (`bank_code` is accepted too);
 *   - the response carries `subaccount_code`, `active`, `is_verified`,
 *     `settlement_schedule` ("AUTO") and `metadata` — sent as a JSON string,
 *     returned as an object;
 *   - Paystack does NOT refuse a second subaccount for the same bank account,
 *     so "exactly once" is entirely ours to guarantee (lib/payments/subaccounts.ts);
 *   - `PUT { active: false }` deactivates one.
 */

export interface PaystackSubaccount {
  code: string;
  active: boolean;
  isVerified: boolean;
  accountName: string | null;
  metadata: Record<string, unknown> | null;
}

type RawSubaccount = {
  subaccount_code?: string;
  active?: boolean;
  is_verified?: boolean;
  account_name?: string | null;
  metadata?: unknown;
};

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toSubaccount(raw: RawSubaccount): PaystackSubaccount {
  if (!raw.subaccount_code) throw new PaystackError('Paystack returned a subaccount without a code.', 200);
  return {
    code: raw.subaccount_code,
    active: raw.active !== false,
    isVerified: raw.is_verified === true,
    accountName: raw.account_name ?? null,
    metadata: parseMetadata(raw.metadata),
  };
}

export interface CreateSubaccountInput {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  description?: string;
  /** stored on the subaccount so it can be found again (e.g. after a timeout) */
  metadata: Record<string, string>;
}

/**
 * Create a subaccount on the platform's integration. `percentage_charge` is
 * always 0: MansaaS takes no commission on sales (ROADMAP 10.1).
 */
export async function createSubaccount(input: CreateSubaccountInput): Promise<PaystackSubaccount> {
  const body: { data?: RawSubaccount } = await paystackFetch('/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      business_name: input.businessName,
      settlement_bank: input.bankCode,
      account_number: input.accountNumber,
      percentage_charge: 0,
      description: input.description,
      primary_contact_name: input.contactName ?? undefined,
      primary_contact_email: input.contactEmail ?? undefined,
      primary_contact_phone: input.contactPhone ?? undefined,
      metadata: JSON.stringify(input.metadata),
    }),
    // Creating is not safely repeatable, so a slow answer is waited for longer
    // before giving up — and even then the caller looks before creating again.
    signal: AbortSignal.timeout(30_000),
  });
  return toSubaccount(body.data ?? {});
}

/** Null when Paystack doesn't know the code. */
export async function fetchSubaccount(code: string): Promise<PaystackSubaccount | null> {
  try {
    const body: { data?: RawSubaccount } = await paystackFetch(`/subaccount/${encodeURIComponent(code)}`);
    return toSubaccount(body.data ?? {});
  } catch (error) {
    if (error instanceof PaystackError && (error.httpStatus === 400 || error.httpStatus === 404)) return null;
    throw error;
  }
}

/**
 * Every subaccount on the integration whose metadata names this key/value —
 * how a subaccount created by a request that timed out is found again. Paystack
 * can't search by metadata, so this pages through the list (newest first).
 */
export async function findSubaccountsByMetadata(key: string, value: string, maxPages = 20): Promise<PaystackSubaccount[]> {
  const found: PaystackSubaccount[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body: { data?: RawSubaccount[]; meta?: { pageCount?: number } } = await paystackFetch(
      `/subaccount?perPage=100&page=${page}`,
    );
    for (const raw of body.data ?? []) {
      if (parseMetadata(raw.metadata)?.[key] === value && raw.subaccount_code) found.push(toSubaccount(raw));
    }
    if (!body.meta?.pageCount || page >= body.meta.pageCount) break;
  }
  return found;
}

/* ---------------- storefront payments (ROADMAP 10.4) ---------------- */

/*
 * Checked in test mode on 2026-09-29: a transaction initialised with
 * `subaccount`, `bearer: "subaccount"` and `transaction_charge: 0` verifies
 * with `fees_split: { paystack, integration: 0, subaccount, params: { bearer:
 * "subaccount", transaction_charge: "0", percentage_charge: "0" } }` and the
 * full `subaccount` object — the platform's share is zero and the merchant
 * pays the fee. An unknown reference answers 400 "Transaction reference not
 * found." In-flight statuses include `ongoing`.
 */

export interface InitializeSplitInput {
  /** minor units (kobo) */
  amount: number;
  email: string;
  currency: string;
  reference: string;
  callbackUrl: string;
  /** the shop's own subaccount — never taken from a browser */
  subaccountCode: string;
  metadata: Record<string, string>;
}

/**
 * Start a storefront payment that settles to the shop's subaccount. The
 * merchant bears Paystack's fee and the platform's share is forced to zero,
 * whatever the subaccount's percentage says (ROADMAP 10.1, 10.13) — so both
 * are fixed here, not parameters.
 */
export async function initializeSplitTransaction(input: InitializeSplitInput): Promise<{ checkoutUrl: string }> {
  const body: { data?: { authorization_url?: string } } = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      subaccount: input.subaccountCode,
      bearer: 'subaccount',
      transaction_charge: 0,
      metadata: input.metadata,
    }),
  });
  if (!body.data?.authorization_url) throw new PaystackError('Paystack returned no payment page.', 200);
  return { checkoutUrl: body.data.authorization_url };
}

export type PaystackTransactionStatus = 'success' | 'failed' | 'abandoned' | 'pending';

export interface PaystackTransaction {
  reference: string;
  status: PaystackTransactionStatus;
  /** minor units */
  amount: number;
  currency: string;
  channel: string | null;
  /** Paystack's transaction id */
  id: string | null;
  /** the subaccount the money was split to, if any */
  subaccountCode: string | null;
  /** from `fees_split`, minor units; null until Paystack reports them */
  split: { merchant: number; platform: number; fee: number } | null;
  raw: Record<string, unknown>;
}

function normalizeTransactionStatus(value: unknown): PaystackTransactionStatus {
  const status = String(value ?? '').toLowerCase();
  if (status === 'success') return 'success';
  if (status === 'failed' || status === 'reversed') return 'failed';
  if (status === 'abandoned') return 'abandoned';
  return 'pending'; // ongoing, pending, processing, queued
}

/**
 * Ask Paystack where a transaction stands — server to server, with the
 * platform's key. The only source this app accepts for "paid". Null when
 * Paystack doesn't know the reference; throws on anything else, so an outage
 * is never read as "no such payment".
 */
export async function verifyPaystackTransaction(reference: string): Promise<PaystackTransaction | null> {
  let body: { data?: Record<string, unknown> };
  try {
    body = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
  } catch (error) {
    if (error instanceof PaystackError && (error.httpStatus === 400 || error.httpStatus === 404)) return null;
    throw error;
  }
  const data = body.data ?? {};
  const sub = data.subaccount as { subaccount_code?: unknown } | null | undefined;
  const feesSplit = data.fees_split as { paystack?: unknown; integration?: unknown; subaccount?: unknown } | null | undefined;
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const split =
    feesSplit && Number.isFinite(num(feesSplit.subaccount)) && Number.isFinite(num(feesSplit.integration))
      ? {
          merchant: num(feesSplit.subaccount),
          platform: num(feesSplit.integration),
          fee: Number.isFinite(num(feesSplit.paystack)) ? num(feesSplit.paystack) : 0,
        }
      : null;
  return {
    reference: String(data.reference ?? reference),
    status: normalizeTransactionStatus(data.status),
    amount: Number(data.amount),
    currency: String(data.currency ?? ''),
    channel: typeof data.channel === 'string' ? data.channel : null,
    id: data.id !== undefined && data.id !== null ? String(data.id) : null,
    subaccountCode: sub && typeof sub.subaccount_code === 'string' ? sub.subaccount_code : null,
    split,
    raw: data,
  };
}

/* ---------------- webhooks (ROADMAP 10.5) ---------------- */

/**
 * Paystack signs every webhook with `x-paystack-signature`: a hex HMAC-SHA512
 * of the RAW request body, keyed with the secret key (Paystack's docs,
 * ROADMAP 10.13). Compared in constant time, so the check leaks nothing about
 * how close a forged signature came.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || paystackConfigProblem()) return false;
  const key = process.env.PAYSTACK_SECRET_KEY!;
  const expected = Buffer.from(createHmac('sha512', key).update(rawBody).digest('hex'));
  const given = Buffer.from(signature.trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}
