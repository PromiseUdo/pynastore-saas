/*
 * lib/payments/squad.ts
 *
 * Thin server-only client for Squad (squadco.com). Never import from a client
 * component — it reads SQUADCO_SECRET_KEY.
 *
 * Only the three things the storefront needs: start a transaction (Squad
 * returns a hosted checkout URL), verify one by reference, and check a
 * webhook's signature. Deciding what a verified transaction MEANS for an
 * order is not this file's job — see lib/storefront/checkout/payment-service.ts.
 *
 * Amounts here are MINOR units (kobo), which is what Squad works in.
 */
import crypto from 'crypto';

const SANDBOX_BASE_URL = 'https://sandbox-api-d.squadco.com';
const LIVE_BASE_URL = 'https://api-d.squadco.com';

export class SquadError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'SquadError';
  }
}

function secretKey(): string {
  const key = process.env.SQUADCO_SECRET_KEY;
  if (!key) throw new SquadError('SQUADCO_SECRET_KEY is not configured.', 0);
  return key;
}

/**
 * The environment follows the key: a `sandbox_sk_` key can only ever talk to
 * the sandbox, so a live key can't be sent to the test API or the reverse.
 * SQUADCO_BASE_URL overrides, for the day Squad moves a host.
 */
export function squadBaseUrl(): string {
  if (process.env.SQUADCO_BASE_URL) return process.env.SQUADCO_BASE_URL.replace(/\/$/, '');
  return secretKey().startsWith('sandbox_') ? SANDBOX_BASE_URL : LIVE_BASE_URL;
}

export function isSquadConfigured(): boolean {
  return Boolean(process.env.SQUADCO_SECRET_KEY);
}

async function squadFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${squadBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });

  let body: { success?: boolean; message?: string; data?: T } | null = null;
  try {
    body = await res.json();
  } catch {
    // Squad occasionally answers errors with an empty or HTML body.
  }

  if (!res.ok || !body?.success || !body.data) {
    throw new SquadError(body?.message ?? `Squad request failed: ${path}`, res.status);
  }
  return body.data;
}

/* ---------------- initiate ---------------- */

export interface SquadInitiateInput {
  /** minor units */
  amount: number;
  email: string;
  currency: string;
  /** ours; must be unique across the Squad account */
  transactionRef: string;
  callbackUrl: string;
  customerName?: string;
  /** returned untouched on verify and on the webhook */
  metadata?: Record<string, string>;
}

export interface SquadInitiateResult {
  checkoutUrl: string;
  transactionRef: string;
}

export async function initiateTransaction(input: SquadInitiateInput): Promise<SquadInitiateResult> {
  const data = await squadFetch<{ checkout_url?: string; transaction_ref?: string }>(
    '/transaction/initiate',
    {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        email: input.email,
        currency: input.currency,
        initiate_type: 'inline',
        transaction_ref: input.transactionRef,
        callback_url: input.callbackUrl,
        customer_name: input.customerName,
        metadata: input.metadata,
      }),
    },
  );

  if (!data.checkout_url) throw new SquadError('Squad returned no checkout URL.', 200);
  return { checkoutUrl: data.checkout_url, transactionRef: data.transaction_ref ?? input.transactionRef };
}

/* ---------------- verify ---------------- */

export type SquadTransactionStatus = 'success' | 'failed' | 'abandoned' | 'pending';

export interface SquadTransaction {
  transactionRef: string;
  status: SquadTransactionStatus;
  /** minor units */
  amount: number;
  currency: string;
  email: string | null;
  channel: string | null;
  raw: Record<string, unknown>;
}

/** Squad's casing varies between endpoints ("pending" here, "Success" on the webhook). */
function normalizeStatus(value: unknown): SquadTransactionStatus {
  const status = String(value ?? '').toLowerCase();
  if (status === 'success' || status === 'failed' || status === 'abandoned') return status;
  return 'pending';
}

/**
 * Ask Squad where a transaction stands. The ONLY source this app accepts for
 * "paid": a redirect can be typed into an address bar and a webhook body can
 * be replayed, but this is a server-to-server call with our secret key.
 *
 * Returns null when Squad doesn't know the reference (it answers that with a
 * 400, or — in the sandbox — a 500). Throws on anything else, so a network
 * blip is never mistaken for "no such payment".
 */
export async function verifyTransaction(transactionRef: string): Promise<SquadTransaction | null> {
  try {
    const data = await squadFetch<Record<string, unknown>>(
      `/transaction/verify/${encodeURIComponent(transactionRef)}`,
    );
    return {
      transactionRef: String(data.transaction_ref ?? transactionRef),
      status: normalizeStatus(data.transaction_status),
      amount: Number(data.transaction_amount),
      currency: String(data.transaction_currency_id ?? ''),
      email: typeof data.email === 'string' ? data.email : null,
      channel: typeof data.transaction_type === 'string' && data.transaction_type !== 'none'
        ? data.transaction_type
        : null,
      raw: data,
    };
  } catch (error) {
    if (error instanceof SquadError && (error.httpStatus === 400 || error.httpStatus === 404)) return null;
    throw error;
  }
}

/* ---------------- webhook ---------------- */

/**
 * Squad signs each webhook with `x-squad-encrypted-body`: an HMAC-SHA512 of
 * the raw request body, keyed with the secret key, hex-encoded (uppercase).
 * Compared case-insensitively and in constant time.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !process.env.SQUADCO_SECRET_KEY) return false;

  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex').toUpperCase();
  const given = signature.trim().toUpperCase();

  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The reference a webhook is about, wherever Squad put it this time. */
export function webhookTransactionRef(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const body = (p.Body ?? p.body) as Record<string, unknown> | undefined;
  const ref = p.TransactionRef ?? p.transaction_reference ?? body?.transaction_ref;
  return typeof ref === 'string' && ref.trim() ? ref.trim() : null;
}
