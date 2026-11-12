/*
 * lib/wallet/edupay.ts
 *
 * The only place that talks to EduPay's Service API (ROADMAP 20). Server
 * only. Everything else goes through lib/wallet/shopper.ts.
 *
 * SIGNING. EduPay's scheme: HMAC-SHA256 over `method|path|timestamp|nonce|
 * body` with the service key, sent with X-Service-{Key,Signature,Timestamp,
 * Nonce}. The scheme also sends the key itself in X-Service-Key, which
 * EduPay has been asked to replace with a key id; until then the key lives
 * only in EDUPAY_SERVICE_KEY and in these headers, never in code or logs.
 *
 * WHAT IS NEVER KEPT. `register_user` still answers with a generated
 * password (EduPay is removing it). It is dropped here, before the response
 * leaves this file, and no response body is ever logged — only the action,
 * the HTTP status and EduPay's error code.
 *
 * NEVER THROWS. A network failure, a timeout or a 5xx is `unavailable`, so
 * a caller can always tell "EduPay said no" from "EduPay didn't answer".
 */
import { createHmac, randomBytes } from 'crypto';

const TIMEOUT_MS = 15_000;

export type EdupayMode = 'test' | 'live';

/**
 * EDUPAY_MODE — which of EduPay's worlds this deployment uses, like
 * PAYSTACK_MODE. Required: wallets stay off without it.
 */
export function edupayMode(): EdupayMode | null {
  const mode = process.env.EDUPAY_MODE?.trim().toLowerCase();
  return mode === 'test' || mode === 'live' ? mode : null;
}

export function edupayConfigured(): boolean {
  return Boolean(process.env.EDUPAY_SERVICE_URL && process.env.EDUPAY_SERVICE_KEY && edupayMode());
}

/**
 * Stored on every wallet record. EduPay's test and live servers are
 * separate worlds: a wallet made in one doesn't exist in the other, so a
 * record from the other mode is set up again rather than read. A change of
 * ADDRESS within the same mode (EduPay moving its test server) changes
 * nothing — which is why this is the mode, not the URL.
 */
export function walletEnvironment(): EdupayMode | null {
  return edupayMode();
}

/** The canonical string EduPay signs. Exported for its test. */
export function canonicalString(method: string, path: string, timestamp: number, nonce: string, body: string): string {
  return [method, path, timestamp, nonce, body].join('|');
}

export function signRequest(key: string, method: string, path: string, timestamp: number, nonce: string, body: string): string {
  return createHmac('sha256', key).update(canonicalString(method, path, timestamp, nonce, body)).digest('hex');
}

type Json = Record<string, unknown>;

/** EduPay error codes that mean EduPay itself failed, whatever the HTTP status. */
const SERVER_FAILURES = new Set(['INTERNAL_ERROR', 'SERVER_ERROR', 'DATABASE_ERROR', 'SERVICE_UNAVAILABLE']);
type Raw = { ok: true; status: number; body: Json } | { ok: false; reason: string };

async function call(payload: Json): Promise<Raw> {
  const base = process.env.EDUPAY_SERVICE_URL;
  const key = process.env.EDUPAY_SERVICE_KEY;
  if (!base || !key) return { ok: false, reason: 'not configured' };

  const url = new URL(`${base.replace(/\/+$/, '')}/`);
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Key': key,
        'X-Service-Signature': signRequest(key, 'POST', url.pathname, timestamp, nonce, body),
        'X-Service-Timestamp': String(timestamp),
        'X-Service-Nonce': nonce,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const parsed = (await response.json().catch(() => null)) as Json | null;
    if (response.status >= 500) {
      console.error(`[edupay] ${String(payload.action)} → HTTP ${response.status}`);
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    // A PHP crash on EduPay's side still arrives as HTTP 200, with the error
    // page as the body (seen 2026-10-29: get_transactions → "Call to undefined
    // function formatServiceTransaction()"). Treated as an outage.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error(`[edupay] ${String(payload.action)} → HTTP ${response.status}, reply wasn’t JSON (EduPay-side error)`);
      return { ok: false, reason: 'not JSON' };
    }
    if (parsed.success !== true) {
      console.warn(`[edupay] ${String(payload.action)} → HTTP ${response.status} ${String(parsed.error_code ?? '')}`);
      // EduPay's own failure, not a refusal of what we sent — answered with
      // HTTP 200 (seen 2026-10-26: register_user → INTERNAL_ERROR). Retried
      // like an outage, so it heals once EduPay is fixed.
      if (typeof parsed.error_code === 'string' && SERVER_FAILURES.has(parsed.error_code.toUpperCase())) {
        return { ok: false, reason: `EduPay ${parsed.error_code}` };
      }
    }
    return { ok: true, status: response.status, body: parsed };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'network error';
    console.error(`[edupay] ${String(payload.action)} → ${reason}`);
    return { ok: false, reason };
  }
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});

/** Naira, as EduPay sends it, to kobo, as the storefront counts (lib/storefront/format.ts). */
export const nairaToKobo = (naira: number) => Math.round(naira * 100);

/* ---------------- register_user ---------------- */

export interface RegisterInput {
  userType: 'normal' | 'business';
  /** Ours, unique at EduPay: `shopper-{customerId}`, later `shop-{organizationId}`. */
  userRef: string;
  fullName: string;
  email: string;
  /** 08031234567 — the spelling EduPay takes (lib/phone.ts toLocalNigerianPhone). */
  phone: string;
  username: string;
}

export type RegisterResult =
  | { kind: 'created'; uuid: string; uniqId: string }
  /** `email` is the existing wallet's, for the caller to compare — never shown to anyone. */
  | { kind: 'exists'; matchedOn: string | null; uuid: string | null; uniqId: string | null; email: string | null }
  | { kind: 'username-taken' }
  | { kind: 'user-ref-taken'; uuid: string | null; uniqId: string | null }
  | { kind: 'rejected'; code: string | null; message: string | null }
  | { kind: 'unavailable'; reason: string };

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const raw = await call({
    action: 'register_user',
    user_type: input.userType,
    user_ref: input.userRef,
    full_name: input.fullName,
    email: input.email,
    phone: input.phone,
    username: input.username,
    metadata: {},
  });
  if (!raw.ok) return { kind: 'unavailable', reason: raw.reason };

  // `credentials` (the generated password) is never read past this line.
  const { body } = raw;
  if (body.success === true) {
    const user = obj(body.user);
    const uuid = str(user.uuid_v4);
    const uniqId = str(user.uniq_id);
    if (uuid && uniqId) return { kind: 'created', uuid, uniqId };
    return { kind: 'rejected', code: 'NO_IDS', message: 'Registered, but the reply had no wallet ids' };
  }

  const code = str(body.error_code);
  const existing = obj(body.existing_user);
  if (code === 'USER_EXISTS') {
    return {
      kind: 'exists',
      matchedOn: str(body.matched_on),
      uuid: str(existing.uuid_v4),
      uniqId: str(existing.uniq_id),
      email: str(existing.email),
    };
  }
  if (code === 'USERNAME_TAKEN') return { kind: 'username-taken' };
  if (code === 'USER_REF_TAKEN') return { kind: 'user-ref-taken', uuid: str(existing.uuid_v4), uniqId: str(existing.uniq_id) };
  return { kind: 'rejected', code, message: str(body.message) };
}

/* ---------------- reading a wallet ---------------- */

export interface WalletIds {
  uuid: string;
  uniqId: string;
}

export interface WalletSummary {
  balanceKobo: number;
  currency: string;
  status: string;
  hasPin: boolean;
}

export async function getWallet(ids: WalletIds): Promise<WalletSummary | null> {
  const raw = await call({ action: 'get_wallet', uuid_v4: ids.uuid, uniq_id: ids.uniqId });
  if (!raw.ok || raw.body.success !== true) return null;
  const wallet = obj(raw.body.wallet);
  const balance = num(wallet.balance);
  if (balance === null) return null;
  return {
    balanceKobo: nairaToKobo(balance),
    currency: str(wallet.currency) ?? 'NGN',
    status: str(wallet.status) ?? 'active',
    hasPin: wallet.has_transaction_pin === true,
  };
}

export interface WalletTransaction {
  reference: string;
  direction: 'credit' | 'debit' | null;
  amountKobo: number;
  description: string | null;
  status: string | null;
  /** ISO 8601 */
  createdAt: string | null;
}

/** EduPay's "2026-10-15 17:41:00" is Lagos time (UTC+1, no daylight saving). */
function lagosToIso(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}+01:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/*
 * Read defensively: no transaction has been seen from EduPay yet (the test
 * wallets were empty), so each field is taken from the names their API uses
 * elsewhere and an item without a reference and an amount is skipped.
 */
function toTransaction(value: unknown): WalletTransaction | null {
  const item = obj(value);
  const reference = str(item.reference) ?? (num(item.id) !== null ? String(item.id) : null);
  const amount = num(item.amount);
  if (!reference || amount === null) return null;
  const type = str(item.type)?.toLowerCase();
  return {
    reference,
    direction: type === 'credit' || type === 'debit' ? type : null,
    amountKobo: nairaToKobo(Math.abs(amount)),
    description: str(item.description),
    status: str(item.status)?.toLowerCase() ?? null,
    createdAt: lagosToIso(item.created_at),
  };
}

export async function getTransactions(
  ids: WalletIds,
  { limit = 10, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ items: WalletTransaction[]; hasMore: boolean; total: number } | null> {
  const raw = await call({ action: 'get_transactions', uuid_v4: ids.uuid, uniq_id: ids.uniqId, limit, offset });
  if (!raw.ok || raw.body.success !== true || !Array.isArray(raw.body.transactions)) return null;
  const items = raw.body.transactions.map(toTransaction).filter((t): t is WalletTransaction => t !== null);
  const pagination = obj(raw.body.pagination);
  return { items, hasMore: pagination.has_more === true, total: num(pagination.total) ?? offset + items.length };
}

/* ---------------- the transaction PIN ---------------- */

/*
 * The PIN passes through here on its way to EduPay and nowhere else: it is
 * never stored, never logged (call() logs only the action and EduPay's
 * error code), and never echoed back to the page.
 */

export interface PinStatus {
  isSet: boolean;
  isLocked: boolean;
  /** ISO 8601, when a lock ends; null when not locked or EduPay didn't say */
  lockedUntil: string | null;
}

export type PinResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-pin' | 'locked' | 'already-set' | 'not-set' | 'weak-pin' | 'rejected' | 'unavailable' };

/*
 * EduPay's PIN refusals, read from the error code and, failing that, the
 * message — no refusal has been seen yet (ROADMAP 20.3), so both are read
 * and anything unrecognised is a plain refusal.
 */
function pinRefusal(body: Json): PinResult {
  const code = (str(body.error_code) ?? '').toUpperCase();
  const message = (str(body.message) ?? '').toLowerCase();
  if (code.includes('LOCK') || message.includes('lock')) return { ok: false, reason: 'locked' };
  if (code.includes('ALREADY') || message.includes('already')) return { ok: false, reason: 'already-set' };
  if (code.includes('NOT_SET') || code.includes('REQUIRES_SETUP') || message.includes('not set') || message.includes('set up a')) {
    return { ok: false, reason: 'not-set' };
  }
  if (code.includes('WEAK') || message.includes('weak') || message.includes('too simple') || message.includes('sequential')) {
    return { ok: false, reason: 'weak-pin' };
  }
  if (code.includes('INCORRECT') || code.includes('INVALID_PIN') || code.includes('WRONG') || message.includes('incorrect') || message.includes('invalid pin') || message.includes('wrong')) {
    return { ok: false, reason: 'wrong-pin' };
  }
  return { ok: false, reason: 'rejected' };
}

async function pinCall(payload: Json): Promise<PinResult> {
  const raw = await call(payload);
  if (!raw.ok) return { ok: false, reason: 'unavailable' };
  return raw.body.success === true ? { ok: true } : pinRefusal(raw.body);
}

export function setUpPin(ids: WalletIds, pin: string): Promise<PinResult> {
  return pinCall({ action: 'setup_transaction_pin', uuid_v4: ids.uuid, uniq_id: ids.uniqId, action_type: 'setup', pin });
}

export function changePin(ids: WalletIds, currentPin: string, pin: string): Promise<PinResult> {
  return pinCall({
    action: 'setup_transaction_pin',
    uuid_v4: ids.uuid,
    uniq_id: ids.uniqId,
    action_type: 'update',
    current_pin: currentPin,
    pin,
  });
}

export function verifyPin(ids: WalletIds, pin: string): Promise<PinResult> {
  return pinCall({ action: 'verify_transaction_pin', uuid_v4: ids.uuid, uniq_id: ids.uniqId, pin });
}

export async function getPinStatus(ids: WalletIds): Promise<PinStatus | null> {
  const raw = await call({ action: 'get_transaction_pin_status', uuid_v4: ids.uuid, uniq_id: ids.uniqId });
  if (!raw.ok || raw.body.success !== true) return null;
  const status = obj(raw.body.status);
  return {
    isSet: status.is_set === true || raw.body.has_pin === true,
    isLocked: status.is_locked === true,
    lockedUntil: lagosToIso(status.locked_until),
  };
}

/* ---------------- top-ups (ROADMAP 20.3) ---------------- */

export type FundingStart =
  | {
      kind: 'started';
      /** EduPay's payment_reference — also Paystack's. */
      reference: string;
      /** For PaystackPop.resumeTransaction: the payment opens on our page. */
      accessCode: string;
      /** Naira: what the wallet receives, the charges on top, and what the payer pays. */
      amount: number;
      fee: number;
      total: number;
      /** ISO 8601, when the unpaid payment lapses */
      expiresAt: string | null;
    }
  | { kind: 'rejected'; message: string | null }
  | { kind: 'unavailable'; reason: string };

/**
 * Start a Paystack payment into this wallet, in naira. EduPay's own Paystack
 * account takes the money and its webhook credits the wallet; we only open
 * the payment window and then ask EduPay whether it landed.
 */
export async function initiateFunding(
  ids: WalletIds,
  input: { amount: number; description: string; metadata: Record<string, string> },
): Promise<FundingStart> {
  const raw = await call({
    action: 'initiate_fund_wallet',
    uuid_v4: ids.uuid,
    uniq_id: ids.uniqId,
    amount: input.amount,
    description: input.description,
    gateway: 'paystack',
    redirect_url: '',
    metadata: input.metadata,
  });
  if (!raw.ok) return { kind: 'unavailable', reason: raw.reason };
  const body = raw.body;
  const reference = str(body.payment_reference) ?? str(body.gateway_reference);
  const accessCode = str(body.access_code);
  const amount = num(body.amount_paid);
  const total = num(body.total_amount);
  if (body.success !== true || !reference || !accessCode || amount === null || total === null) {
    return { kind: 'rejected', message: str(body.message) };
  }
  return {
    kind: 'started',
    reference,
    accessCode,
    amount,
    fee: num(body.transaction_charges) ?? Math.max(0, total - amount),
    total,
    expiresAt: lagosToIso(body.expires_at),
  };
}

export type FundingState = 'completed' | 'failed' | 'pending' | 'unknown' | 'unavailable';

const DONE = new Set(['completed', 'success', 'successful', 'paid']);
const BROKEN = new Set(['failed', 'abandoned', 'reversed', 'cancelled', 'expired']);

function stateOf(status: string | null): 'completed' | 'failed' | 'pending' | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (DONE.has(s)) return 'completed';
  if (BROKEN.has(s)) return 'failed';
  if (s === 'pending' || s === 'processing' || s === 'initiated' || s === 'ongoing') return 'pending';
  return null;
}

/*
 * Whether a top-up has landed. EduPay's status call doesn't know our
 * reference yet, so two readings are tried: `get_transaction_status` for the
 * reference, then the wallet's latest transactions, matched on any of the
 * reference fields EduPay uses. "unknown" means neither has heard of it yet,
 * which is normal for a minute or so after Paystack takes the money.
 */
export async function fundingState(ids: WalletIds, reference: string): Promise<FundingState> {
  const status = await call({ action: 'get_transaction_status', uuid_v4: ids.uuid, uniq_id: ids.uniqId, reference });
  if (status.ok && status.body.success === true) {
    const tx = obj(status.body.transaction);
    const found = stateOf(str(status.body.status) ?? str(obj(status.body.status).status) ?? str(tx.status));
    if (found) return found;
  }

  const list = await call({ action: 'get_transactions', uuid_v4: ids.uuid, uniq_id: ids.uniqId, limit: 30, offset: 0 });
  if (!list.ok) return status.ok ? 'unknown' : 'unavailable';
  if (list.body.success !== true || !Array.isArray(list.body.transactions)) return 'unknown';
  for (const value of list.body.transactions) {
    const item = obj(value);
    if (mentions(item, reference)) return stateOf(str(item.status)) ?? 'pending';
  }
  return 'unknown';
}

/**
 * Whether one of EduPay's transactions is about our reference. What EduPay
 * actually sends (seen 2026-10-29): a transaction has its own TXN…
 * reference, and ours only appears in the description — "Wallet funding via
 * paystack (TXREF_ECOM_…)". Matched as a whole token, so `…_1` is not `…_12`.
 */
function mentions(item: Json, reference: string): boolean {
  const refs = [item.reference, item.payment_reference, item.gateway_reference, item.external_reference, obj(item.metadata).payment_reference]
    .map(str)
    .filter((r): r is string => r !== null);
  return refs.includes(reference) || (str(item.description)?.match(/[A-Za-z0-9_-]+/g)?.includes(reference) ?? false);
}

/* ---------------- moving money between wallets (ROADMAP 20.5, 20.6) ---------------- */

export type TransferResult =
  /** EduPay says the money moved. `reference` is EduPay's own (TXN…), when it names one. */
  | { kind: 'sent'; reference: string | null; reply: Json }
  /** EduPay refused, so nothing moved. */
  | { kind: 'refused'; reason: 'wrong-pin' | 'locked' | 'pin-not-set' | 'insufficient' | 'rejected'; message: string | null }
  /**
   * No clear answer — a timeout, a crash, a reply we can't read. The money
   * MAY have moved: never try again on this, look for the transfer instead
   * (`findTransfer`).
   */
  | { kind: 'unknown'; reason: string };

/*
 * EduPay's refusals for a transfer are read like the PIN calls' (no reply
 * has been seen yet, 2026-11-01): not enough money first, then the PIN's own
 * answers, and anything unrecognised is a plain refusal.
 */
function transferRefusal(body: Json): TransferResult {
  const code = (str(body.error_code) ?? '').toUpperCase();
  const message = str(body.message);
  if (code.includes('INSUFFICIENT') || /insufficient|not enough/i.test(message ?? '')) {
    return { kind: 'refused', reason: 'insufficient', message };
  }
  const pin = pinRefusal(body);
  const reason = pin.ok ? 'rejected' : pin.reason === 'wrong-pin' || pin.reason === 'locked' ? pin.reason : pin.reason === 'not-set' ? 'pin-not-set' : 'rejected';
  return { kind: 'refused', reason, message };
}

/**
 * Move `amount` naira from one wallet to another with the payer's PIN —
 * EduPay's `transfer_funds`, one call that debits one wallet and credits the
 * other. Used for refunds (20.6); an order is paid with `debitForOrder`. `description` should carry our own reference: it is how
 * `findTransfer` recognises the transfer later.
 */
export async function transferFunds(
  from: WalletIds,
  to: WalletIds,
  input: { amount: number; description: string; pin: string },
): Promise<TransferResult> {
  const raw = await call({
    action: 'transfer_funds',
    uuid_v4: from.uuid,
    uniq_id: from.uniqId,
    recipient_uuid_v4: to.uuid,
    recipient_uniq_id: to.uniqId,
    amount: input.amount,
    description: input.description,
    pin: input.pin,
  });
  if (!raw.ok) {
    // Only "not configured" is certain never to have reached EduPay.
    return raw.reason === 'not configured' ? { kind: 'refused', reason: 'rejected', message: null } : { kind: 'unknown', reason: raw.reason };
  }
  if (raw.body.success !== true) return transferRefusal(raw.body);
  const tx = obj(raw.body.transaction);
  return {
    kind: 'sent',
    reference: str(tx.reference) ?? str(raw.body.reference) ?? str(raw.body.transaction_reference),
    reply: raw.body,
  };
}

/**
 * Pay for an order: EduPay's `debit_wallet` with a receiver, one call that
 * takes `amount` naira from the shopper's wallet and gives it to the shop's,
 * with the shopper's PIN (ROADMAP 20.5). `orderId` stays the same across
 * tries at one order — so EduPay can refuse a repeat — and `reference` is the
 * one try, which `findTransfer` recognises later.
 */
export async function debitForOrder(
  from: WalletIds,
  to: WalletIds,
  input: { amount: number; description: string; orderId: string; reference: string; orderReference: string; pin: string },
): Promise<TransferResult> {
  const raw = await call({
    action: 'debit_wallet',
    uuid_v4: from.uuid,
    uniq_id: from.uniqId,
    receiver_uuid_v4: to.uuid,
    receiver_uniq_id: to.uniqId,
    amount: input.amount,
    description: input.description,
    order_id: input.orderId,
    item_type: 'ecommerce_order',
    pin: input.pin,
    metadata: { payment_reference: input.reference, order_reference: input.orderReference },
  });
  if (!raw.ok) {
    return raw.reason === 'not configured' ? { kind: 'refused', reason: 'rejected', message: null } : { kind: 'unknown', reason: raw.reason };
  }
  if (raw.body.success !== true) {
    // "Already paid" isn't "nothing moved": the money may have gone on an earlier try.
    if (/DUPLICATE|ALREADY/i.test(str(raw.body.error_code) ?? '') || /duplicate|already (been )?(paid|processed|debited)/i.test(str(raw.body.message) ?? '')) {
      return { kind: 'unknown', reason: 'EduPay says this order was already debited' };
    }
    return transferRefusal(raw.body);
  }
  const tx = obj(raw.body.transaction);
  return {
    kind: 'sent',
    reference: str(tx.reference) ?? str(raw.body.reference) ?? str(raw.body.transaction_reference),
    reply: raw.body,
  };
}

/**
 * Look for a transfer among the payer's latest transactions by our
 * reference: what it became, EduPay's own reference for it, or 'not-found'.
 */
export async function findTransfer(
  from: WalletIds,
  reference: string,
): Promise<{ state: Exclude<FundingState, 'unknown' | 'unavailable'>; reference: string | null } | 'not-found' | 'unavailable'> {
  const list = await call({ action: 'get_transactions', uuid_v4: from.uuid, uniq_id: from.uniqId, limit: 30, offset: 0 });
  if (!list.ok || list.body.success !== true || !Array.isArray(list.body.transactions)) return 'unavailable';
  for (const value of list.body.transactions) {
    const item = obj(value);
    if (item.type !== undefined && str(item.type)?.toLowerCase() !== 'debit') continue;
    if (mentions(item, reference)) return { state: stateOf(str(item.status)) ?? 'pending', reference: str(item.reference) };
  }
  return 'not-found';
}

/* ---------------- bank accounts, withdrawals, auto-withdraw (ROADMAP 20.7) ---------------- */

/*
 * Adding a bank account and withdrawing are both two steps: EduPay emails a
 * code to the wallet's address, and the second call carries it. No reply for
 * the second steps has been seen yet (2026-11-03), so wrong and expired codes
 * are read from the words. `debug_otp`, which a test server may send, is never
 * read: a code belongs in the wallet holder's inbox.
 */

export interface EduPayBankAccount {
  id: number;
  accountNumber: string;
  bankCode: string | null;
  active: boolean;
}

export async function getBankAccounts(ids: WalletIds): Promise<EduPayBankAccount[] | null> {
  const raw = await call({ action: 'get_bank_accounts', uuid_v4: ids.uuid, uniq_id: ids.uniqId });
  if (!raw.ok || raw.body.success !== true || !Array.isArray(raw.body.accounts)) return null;
  const accounts: EduPayBankAccount[] = [];
  for (const value of raw.body.accounts) {
    const item = obj(value);
    const id = num(item.id) ?? num(item.account_id);
    const accountNumber = str(item.account_number);
    if (id === null || !accountNumber) continue;
    const status = str(item.status)?.toLowerCase();
    accounts.push({
      id,
      accountNumber,
      bankCode: str(item.bank_code),
      active: item.is_active !== false && item.is_active !== 0 && (!status || status === 'active' || status === 'verified'),
    });
  }
  return accounts;
}

export type CodeRequest =
  | { kind: 'code-sent' }
  /** EduPay refused; nothing changed */
  | { kind: 'refused'; reason: 'too-low' | 'insufficient' | 'account-gone' | 'code-not-sent' | 'rejected'; message: string | null }
  | { kind: 'unavailable' };

function codeRequest(raw: Raw): CodeRequest {
  if (!raw.ok) return { kind: 'unavailable' };
  if (raw.body.success === true) return { kind: 'code-sent' };
  const code = (str(raw.body.error_code) ?? '').toUpperCase();
  const message = str(raw.body.message);
  const words = (message ?? '').toLowerCase();
  if (code === 'AMOUNT_TOO_LOW' || words.includes('minimum withdrawal')) return { kind: 'refused', reason: 'too-low', message };
  if (code === 'INSUFFICIENT_BALANCE' || words.includes('insufficient')) return { kind: 'refused', reason: 'insufficient', message };
  if (code === 'MISSING_ACCOUNT_ID' || words.includes('bank account not found')) return { kind: 'refused', reason: 'account-gone', message };
  if (code === 'FAILED_TO_SEND_OTP' || words.includes('failed to send otp')) return { kind: 'refused', reason: 'code-not-sent', message };
  return { kind: 'refused', reason: 'rejected', message };
}

export type CodeConfirm =
  | { kind: 'done'; reference: string | null }
  | { kind: 'wrong-code' }
  | { kind: 'expired' }
  /** EduPay refused for another reason; nothing moved */
  | { kind: 'refused'; message: string | null }
  /** no clear answer: it may have gone through */
  | { kind: 'unknown'; reason: string };

function codeConfirm(raw: Raw): CodeConfirm {
  if (!raw.ok) return { kind: 'unknown', reason: raw.reason };
  if (raw.body.success === true) {
    const tx = obj(raw.body.transaction);
    return { kind: 'done', reference: str(tx.reference) ?? str(raw.body.reference) ?? str(raw.body.transaction_reference) };
  }
  const code = (str(raw.body.error_code) ?? '').toUpperCase();
  const message = str(raw.body.message);
  const words = (message ?? '').toLowerCase();
  if (code.includes('EXPIRED') || words.includes('expired') || words.includes('no pending')) return { kind: 'expired' };
  if (code.includes('OTP') || words.includes('otp') || words.includes('code')) return { kind: 'wrong-code' };
  return { kind: 'refused', message };
}

export async function requestAddBankAccount(ids: WalletIds, account: { accountNumber: string; bankCode: string; bankName: string }): Promise<CodeRequest> {
  return codeRequest(
    await call({
      action: 'request_add_bank_account',
      uuid_v4: ids.uuid,
      uniq_id: ids.uniqId,
      account_number: account.accountNumber,
      bank_code: account.bankCode,
      bank_name: account.bankName,
    }),
  );
}

export async function confirmAddBankAccount(ids: WalletIds, otp: string): Promise<CodeConfirm> {
  return codeConfirm(await call({ action: 'confirm_add_bank_account', uuid_v4: ids.uuid, uniq_id: ids.uniqId, otp }));
}

export async function requestWithdraw(ids: WalletIds, input: { amount: number; accountId: number; description: string }): Promise<CodeRequest> {
  return codeRequest(
    await call({
      action: 'request_withdraw',
      uuid_v4: ids.uuid,
      uniq_id: ids.uniqId,
      amount: input.amount,
      account_id: input.accountId,
      description: input.description,
    }),
  );
}

/** Debits the wallet and starts the bank transfer; EduPay puts the money back if that fails. */
export async function confirmWithdraw(ids: WalletIds, otp: string): Promise<CodeConfirm> {
  return codeConfirm(await call({ action: 'confirm_withdraw', uuid_v4: ids.uuid, uniq_id: ids.uniqId, otp }));
}

/**
 * What became of a withdrawal, by our reference: a credit mentioning it means
 * the bank transfer failed and the money came back.
 */
export async function withdrawalState(
  ids: WalletIds,
  reference: string,
): Promise<{ state: 'completed' | 'pending' | 'failed' | 'returned'; reference: string | null } | 'not-found' | 'unavailable'> {
  const list = await call({ action: 'get_transactions', uuid_v4: ids.uuid, uniq_id: ids.uniqId, limit: 50, offset: 0 });
  if (!list.ok || list.body.success !== true || !Array.isArray(list.body.transactions)) return 'unavailable';
  const items = list.body.transactions.map(obj).filter((item) => mentions(item, reference));
  const type = (item: Json) => str(item.type)?.toLowerCase();
  const credit = items.find((item) => type(item) === 'credit');
  if (credit) return { state: 'returned', reference: str(credit.reference) };
  const debit = items.find((item) => type(item) !== 'credit');
  if (!debit) return 'not-found';
  return { state: stateOf(str(debit.status)) ?? 'pending', reference: str(debit.reference) };
}

export interface AutoWithdrawSettings {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  /** HH:MM:SS */
  time: string;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  /** naira */
  minAmount: number;
  maxAmount: number | null;
  reserve: number;
  bankAccountId: number | null;
  notifyOnRun: boolean;
}

/** Null when EduPay can't be asked — which is not "off". */
export async function getAutoWithdraw(ids: WalletIds): Promise<AutoWithdrawSettings | null> {
  const raw = await call({ action: 'get_auto_withdraw_settings', uuid_v4: ids.uuid, uniq_id: ids.uniqId });
  if (!raw.ok || raw.body.success !== true) return null;
  const s = obj(raw.body.settings);
  const frequency = str(s.schedule_frequency);
  return {
    enabled: s.auto_withdraw_enabled === true || s.auto_withdraw_enabled === 1 || s.auto_withdraw_enabled === '1',
    frequency: frequency === 'weekly' || frequency === 'monthly' ? frequency : 'daily',
    time: str(s.schedule_time) ?? '06:05:00',
    dayOfWeek: num(s.schedule_day_of_week),
    dayOfMonth: num(s.schedule_day_of_month),
    minAmount: num(s.min_withdrawal_amount) ?? 100,
    maxAmount: num(s.max_withdrawal_amount),
    reserve: num(s.reserve_balance) ?? 0,
    bankAccountId: num(s.default_bank_account_id),
    notifyOnRun: s.notify_on_run !== false && s.notify_on_run !== 0,
  };
}

export async function updateAutoWithdraw(ids: WalletIds, settings: AutoWithdrawSettings): Promise<{ ok: true } | { ok: false; unavailable: boolean; message: string | null }> {
  const raw = await call({
    action: 'update_auto_withdraw_settings',
    uuid_v4: ids.uuid,
    uniq_id: ids.uniqId,
    auto_withdraw_enabled: settings.enabled,
    schedule_time: settings.time,
    schedule_frequency: settings.frequency,
    ...(settings.frequency === 'weekly' && settings.dayOfWeek !== null ? { schedule_day_of_week: settings.dayOfWeek } : {}),
    ...(settings.frequency === 'monthly' && settings.dayOfMonth !== null ? { schedule_day_of_month: settings.dayOfMonth } : {}),
    min_withdrawal_amount: settings.minAmount,
    ...(settings.maxAmount !== null ? { max_withdrawal_amount: settings.maxAmount } : {}),
    reserve_balance: settings.reserve,
    default_bank_account_id: settings.bankAccountId,
    notify_on_run: settings.notifyOnRun,
  });
  if (!raw.ok) return { ok: false, unavailable: true, message: null };
  return raw.body.success === true ? { ok: true } : { ok: false, unavailable: false, message: str(raw.body.message) };
}

export interface AutoWithdrawRun {
  status: string | null;
  /** naira */
  amount: number | null;
  /** why it was skipped or failed, as EduPay said */
  message: string | null;
  /** ISO 8601 */
  at: string | null;
}

export async function getAutoWithdrawHistory(ids: WalletIds, { limit = 10 }: { limit?: number } = {}): Promise<AutoWithdrawRun[] | null> {
  const raw = await call({ action: 'get_auto_withdraw_history', uuid_v4: ids.uuid, uniq_id: ids.uniqId, limit, offset: 0 });
  if (!raw.ok || raw.body.success !== true || !Array.isArray(raw.body.runs)) return null;
  return raw.body.runs.map(obj).map((run) => ({
    status: str(run.status)?.toLowerCase() ?? null,
    amount: num(run.amount),
    message: str(run.message) ?? str(run.reason),
    at: lagosToIso(run.created_at ?? run.run_at),
  }));
}
