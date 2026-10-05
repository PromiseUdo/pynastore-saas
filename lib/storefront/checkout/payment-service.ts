/*
 * lib/storefront/checkout/payment-service.ts
 *
 * Paying for an online order. Server only.
 *
 * THE FLOW (ROADMAP 10.4)
 *
 *   place order ─▶ startOrderPayment() ─▶ Paystack /transaction/initialize
 *                        │                  (the shop's subaccount, the merchant
 *                        │                   bears the fee, platform share 0)
 *                        │                       └─ authorization_url
 *                        └─ OrderPayment row (PENDING, our reference, subaccount)
 *   shopper pays on Paystack's page
 *   Paystack ─▶ /api/payments/paystack/callback (the browser)  ┐
 *   Paystack ─▶ webhook (server, ROADMAP 10.5)                 ├─▶ reconcilePayment()
 *   confirmation page load (safety net)                        ┘   └─ provider's /verify
 *
 * THE ONE RULE: an order becomes PAID only because the provider's verify
 * endpoint, called here with the platform's secret key, said so — for the
 * amount and currency we asked for and, on Paystack, to the subaccount we sent
 * it to with nothing for the platform. The callback's query string and a
 * webhook's body are only ever treated as "go and check this reference". Every
 * door leads to one check, and the check is idempotent.
 *
 * PROVIDERS. Every attempt goes to Paystack. Squad took storefront payments
 * until checkout moved (10.4) and was retired in 10.9: its attempts stay as
 * history, and one still PENDING can no longer be verified, so it is answered
 * 'unverifiable' without calling anyone — never guessed paid or unpaid. The
 * expiry job still cancels its order after the hold window, as for any
 * payment that never arrived.
 *
 * READINESS. A new payment is only started for a shop that may take online
 * payments (onlinePaymentReadiness, 10.8): verified by us, subaccount active,
 * not suspended. Checkout doesn't offer the method otherwise; this is the
 * server's own check.
 *
 * LATE PAYMENTS. An unpaid order gives its stock back after a while
 * (orders/lifecycle.ts). If the money arrives after that, the order is
 * revived when the stock can be held again; if it can't, the order stays
 * cancelled but PAID, the shopper is told to arrange a refund, and the
 * merchant sees exactly that combination on the order.
 *
 * ATTEMPTS. A provider refuses a reused transaction reference, so every "Pay
 * now" is its own OrderPayment row with its own reference. The order keeps its
 * shopper-facing ORD- reference throughout.
 *
 * Money: the order stores major units; providers take minor units (kobo).
 */
import { subaccountMatchesMode } from '@/lib/payments/subaccounts';
import { randomBytes } from 'crypto';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  initializeSplitTransaction,
  isPaystackConfigured,
  verifyPaystackTransaction,
} from '@/lib/payments/paystack';
import { getOnlinePaymentReadiness } from '@/lib/payments/online-readiness';
import { OutOfStockError, reReserveOrderStock } from '../orders/stock';
import { requestGatheringTransfers } from '../orders/gather';
import { reclaimDiscountUse } from '../discounts/usage';
import { notifyShopper } from '../orders/notifications';

/** The checkout method (and attempt provider) for paying online. */
export const ONLINE_PAYMENT_METHOD = 'paystack';
/** Orders placed before checkout moved to Paystack; Squad is retired (ROADMAP 10.9). History only. */
export const LEGACY_SQUAD_METHOD = 'squad';
/** Every method whose money is taken online by a provider, past or present. */
export const ONLINE_PAYMENT_METHODS = [ONLINE_PAYMENT_METHOD, LEGACY_SQUAD_METHOD] as const;

export function isOnlinePaymentMethod(method: string): boolean {
  return (ONLINE_PAYMENT_METHODS as readonly string[]).includes(method);
}

/** What Paystack said about one transaction. */
interface VerifiedPayment {
  status: 'success' | 'failed' | 'abandoned' | 'pending';
  /** minor units */
  amount: number;
  currency: string;
  channel: string | null;
  gatewayRef: string | null;
  subaccountCode: string | null;
  split: { merchant: number; platform: number; fee: number } | null;
  raw: Record<string, unknown>;
}

/** Ask Paystack about an attempt. Null: it doesn't know the reference. */
async function verifyWithProvider(reference: string): Promise<VerifiedPayment | null> {
  const t = await verifyPaystackTransaction(reference);
  if (!t) return null;
  return {
    status: t.status,
    amount: t.amount,
    currency: t.currency,
    channel: t.channel,
    gatewayRef: t.id,
    subaccountCode: t.subaccountCode,
    split: t.split,
    raw: t.raw,
  };
}

/** Orders in these states may still be paid online. */
const PAYABLE_ORDER_STATUSES = ['PENDING', 'CONFIRMED'] as const;

/** Major-unit Decimal → integer minor units, without float drift. */
function toMinor(amount: Prisma.Decimal): number {
  return amount.times(100).toDecimalPlaces(0).toNumber();
}

/**
 * Our transaction reference: the order reference, for a human reading the
 * Paystack dashboard, plus randomness, because each attempt needs its own.
 */
function attemptReference(orderReference: string): string {
  return `${orderReference}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

/* ---------------- starting ---------------- */

export type StartPaymentResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; reason: 'already-paid' | 'not-payable' | 'unavailable' };

/**
 * Open a Paystack payment for an order and return where to send the shopper.
 * Everything the provider is told — amount, currency, subaccount, who bears
 * the fee — comes from the database, never the request.
 *
 * `origin` is the public origin the shopper is browsing (their store's own
 * host), so Paystack returns them to the store they bought from. `returnPath`
 * is the store-relative confirmation page to land on afterwards.
 */
export async function startOrderPayment(input: {
  organizationId: string;
  orderId: string;
  origin: string;
  returnPath: string;
  /** started inside the phone app — see the callback route */
  nativeApp?: boolean;
  /** that app's URL scheme (its app id), checked by the caller (ROADMAP 16.1) */
  nativeAppScheme?: string | null;
}): Promise<StartPaymentResult> {
  if (!isPaystackConfigured()) {
    console.error('[payments] PAYSTACK_SECRET_KEY is not set; cannot start a payment.');
    return { ok: false, reason: 'unavailable' };
  }

  const order = await prisma.order.findFirst({
    /* Online payment is for orders placed online. A counter sale is settled
     * at the till and must never be pushed through a checkout link. */
    where: { id: input.orderId, organizationId: input.organizationId, channel: 'ONLINE' },
    select: {
      id: true,
      reference: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      totalAmount: true,
      currency: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  });
  // The gateway needs somewhere to send the receipt; no email, no payment.
  if (!order || !order.email) return { ok: false, reason: 'not-payable' };

  /* An earlier attempt may have been paid without us hearing yet (webhook
   * still on its way, shopper closed the tab before the redirect). Settle
   * those first — starting a second payment for a paid order charges twice. */
  await reconcileOpenAttempts(order.id);

  const fresh = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { paymentStatus: true, status: true },
  });
  if (fresh.paymentStatus === 'PAID') return { ok: false, reason: 'already-paid' };
  if (
    order.paymentMethod !== ONLINE_PAYMENT_METHOD ||
    fresh.paymentStatus !== 'AWAITING_PAYMENT' ||
    !(PAYABLE_ORDER_STATUSES as readonly string[]).includes(fresh.status)
  ) {
    return { ok: false, reason: 'not-payable' };
  }

  // The shop must still be able to take online payments (10.8), and the money
  // goes to ITS subaccount — read from its own record, never the request.
  const [readiness, account] = await Promise.all([
    getOnlinePaymentReadiness(input.organizationId),
    prisma.merchantPaymentAccount.findUnique({
      where: { organizationId: input.organizationId },
      select: { paystackSubaccountCode: true, paystackSubaccountMode: true },
    }),
  ]);
  // Never a subaccount from the other Paystack mode (13.9) — readiness says so too; this is the belt.
  const subaccountCode = account && subaccountMatchesMode(account) ? account.paystackSubaccountCode : null;
  if (!readiness.ready || !subaccountCode) {
    console.warn(`[payments] ${order.reference}: the shop can't take online payments (${readiness.blocker ?? 'no subaccount'}).`);
    return { ok: false, reason: 'unavailable' };
  }

  const reference = attemptReference(order.reference);
  const returnUrl = `${input.origin}${input.returnPath}`;

  const attempt = await prisma.orderPayment.create({
    data: {
      organizationId: input.organizationId,
      orderId: order.id,
      provider: ONLINE_PAYMENT_METHOD,
      reference,
      subaccountCode,
      amount: order.totalAmount,
      currency: order.currency,
      returnUrl,
      nativeApp: Boolean(input.nativeApp),
      nativeAppScheme: input.nativeApp ? (input.nativeAppScheme ?? null) : null,
    },
    select: { id: true },
  });

  try {
    const { checkoutUrl } = await initializeSplitTransaction({
      amount: toMinor(order.totalAmount),
      currency: order.currency,
      email: order.email,
      reference,
      callbackUrl: `${input.origin}/api/payments/paystack/callback?ref=${encodeURIComponent(reference)}`,
      subaccountCode,
      // For reconciliation and support; never trusted on the way back.
      metadata: {
        purpose: 'storefront-order',
        organizationId: input.organizationId,
        orderId: order.id,
        orderReference: order.reference,
        attemptId: attempt.id,
      },
    });

    await prisma.orderPayment.update({ where: { id: attempt.id }, data: { checkoutUrl } });
    return { ok: true, checkoutUrl };
  } catch (error) {
    console.error(`[payments] Could not start a Paystack payment for ${order.reference}:`, error);
    await prisma.orderPayment.update({ where: { id: attempt.id }, data: { status: 'FAILED' } });
    return { ok: false, reason: 'unavailable' };
  }
}

/* ---------------- settling ---------------- */

export type ReconcileOutcome =
  | 'paid'
  | 'already-paid'
  | 'pending'
  | 'failed'
  | 'mismatch'
  | 'unknown-reference'
  /** a Squad-era attempt: Squad is retired, so there's nobody left to ask */
  | 'unverifiable'
  | 'error';

/**
 * Bring one attempt in line with what its provider says. Safe to call any
 * number of times, from anywhere, in any order: it only ever moves an attempt
 * out of PENDING once, and an order into PAID once.
 */
export async function reconcilePayment(reference: string): Promise<ReconcileOutcome> {
  const attempt = await prisma.orderPayment.findUnique({
    where: { reference },
    select: { id: true, status: true, amount: true, currency: true, orderId: true, provider: true, subaccountCode: true },
  });
  if (!attempt) return 'unknown-reference';
  if (attempt.status === 'SUCCESS') return 'already-paid';
  if (attempt.provider !== ONLINE_PAYMENT_METHOD) return 'unverifiable';

  let transaction: VerifiedPayment | null;
  try {
    transaction = await verifyWithProvider(reference);
  } catch (error) {
    console.error(`[payments] Could not verify ${reference} with ${attempt.provider}:`, error);
    return 'error';
  }

  // The provider has no record yet: the shopper never reached its page.
  if (!transaction || transaction.status === 'pending') return 'pending';

  const payload = transaction.raw as Prisma.InputJsonValue;

  if (transaction.status === 'failed' || transaction.status === 'abandoned') {
    await prisma.orderPayment.updateMany({
      where: { id: attempt.id, status: 'PENDING' },
      data: {
        status: transaction.status === 'failed' ? 'FAILED' : 'ABANDONED',
        providerPayload: payload,
        verifiedAt: new Date(),
      },
    });
    return 'failed';
  }

  /* Paid — but for what we asked? A transaction for a different amount is not
   * payment for this order, whatever its status. It's recorded for a human
   * to look at rather than silently accepted or silently dropped. */
  /* The money must also have gone to the subaccount we sent it to, with
   * nothing for the platform (10.1). A payment split any other way is not this
   * shop's payment, whatever its status. */
  const expected = toMinor(attempt.amount);
  const wrongAmount =
    transaction.amount !== expected || transaction.currency.toUpperCase() !== attempt.currency.toUpperCase();
  const wrongSplit =
    transaction.subaccountCode !== attempt.subaccountCode || (transaction.split !== null && transaction.split.platform !== 0);
  if (wrongAmount || wrongSplit) {
    console.error(
      `[payments] ${reference}: ${attempt.provider} reports ${transaction.amount} ${transaction.currency} to ` +
        `${transaction.subaccountCode ?? 'no subaccount'} (platform share ${transaction.split?.platform ?? '—'}), ` +
        `expected ${expected} ${attempt.currency} to ${attempt.subaccountCode ?? '—'}.`,
    );
    await prisma.orderPayment.updateMany({
      where: { id: attempt.id, status: 'PENDING' },
      data: { status: 'MISMATCH', providerPayload: payload, verifiedAt: new Date() },
    });
    return 'mismatch';
  }

  const now = new Date();
  const settled = await prisma.$transaction(async (tx) => {
    // The guard on status is what makes a webhook and a redirect racing each
    // other settle the order exactly once.
    const claimed = await tx.orderPayment.updateMany({
      where: { id: attempt.id, status: { not: 'SUCCESS' } },
      data: {
        status: 'SUCCESS',
        channel: transaction.channel,
        gatewayRef: transaction.gatewayRef,
        // Paystack's own split, as it reported it — shown to the merchant (10.6).
        ...(transaction.split
          ? {
              merchantAmount: new Prisma.Decimal(transaction.split.merchant).dividedBy(100),
              platformAmount: new Prisma.Decimal(transaction.split.platform).dividedBy(100),
              feeAmount: new Prisma.Decimal(transaction.split.fee).dividedBy(100),
            }
          : {}),
        providerPayload: payload,
        verifiedAt: now,
      },
    });
    if (claimed.count === 0) return null;

    const order = await tx.order.findUniqueOrThrow({
      where: { id: attempt.orderId },
      select: { status: true, paymentStatus: true, cancelReason: true },
    });

    await tx.order.update({
      where: { id: attempt.orderId },
      data: {
        paymentStatus: 'PAID',
        paidAt: order.paymentStatus === 'PAID' ? undefined : now,
        // Paying is what confirms an online order. Anything further along —
        // or cancelled — keeps its status; the money is still recorded.
        ...(order.status === 'PENDING' ? { status: 'CONFIRMED' as const, confirmedAt: now } : {}),
      },
    });
    // Confirmed: ask other stores for anything being brought together (Phase 9.7).
    if (order.status === 'PENDING') await requestGatheringTransfers(tx, attempt.orderId);

    return order;
  });

  if (!settled) return 'already-paid';

  if (settled.status === 'CANCELLED' && settled.cancelReason === 'payment-timeout') {
    const revived = await reviveTimedOutOrder(attempt.orderId);
    await notifyShopper(attempt.orderId, revived ? 'payment-received' : 'cancelled');
  } else if (settled.status !== 'CANCELLED') {
    await notifyShopper(attempt.orderId, 'payment-received');
  }

  return 'paid';
}

/**
 * The payment beat the hold's expiry by too little. Take the order back if
 * its stock can still be held; otherwise leave it cancelled (and paid).
 */
export async function reviveTimedOutOrder(orderId: string): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { organizationId: true, discountCodeId: true },
      });
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: 'CANCELLED', cancelReason: 'payment-timeout' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), cancelledAt: null, cancelReason: null },
      });
      if (claimed.count === 0) throw new OutOfStockError('already-handled');
      await reReserveOrderStock(tx, { organizationId: order.organizationId, orderId });
      await requestGatheringTransfers(tx, orderId);
      // The cancellation gave the discount code's use back; take it again.
      await reclaimDiscountUse(tx, order.discountCodeId);
    });
    return true;
  } catch (error) {
    if (!(error instanceof OutOfStockError)) {
      console.error(`[payments] Could not revive order ${orderId} after a late payment:`, error);
    } else {
      console.warn(`[payments] Order ${orderId} was paid after its hold lapsed and the stock is gone — needs a refund.`);
    }
    return false;
  }
}

/**
 * Platform staff's "Check with Paystack" on a payment that never confirmed
 * (ROADMAP 11.6). The same settling as everywhere else — plus one thing only
 * staff do: an attempt Paystack has NO record of, older than the hold, is
 * closed as abandoned (the shopper never reached Paystack's page), so it stops
 * showing as stuck. An attempt Paystack knows about is never closed here.
 */
export async function recheckPaymentForStaff(
  reference: string,
  /** the unpaid-order hold (UNPAID_ORDER_HOLD_MINUTES) — passed in to keep lifecycle.ts out of this module */
  holdMinutes: number,
  now = new Date(),
): Promise<ReconcileOutcome | 'abandoned'> {
  const outcome = await reconcilePayment(reference);
  if (outcome !== 'pending') return outcome;
  const attempt = await prisma.orderPayment.findUnique({ where: { reference }, select: { id: true, createdAt: true } });
  if (!attempt || now.getTime() - attempt.createdAt.getTime() < holdMinutes * 60_000) return outcome;
  let known: VerifiedPayment | null;
  try {
    known = await verifyWithProvider(reference);
  } catch {
    return 'error';
  }
  if (known) return outcome; // Paystack has it, still pending (e.g. a transfer on its way) — leave it.
  await prisma.orderPayment.updateMany({
    where: { id: attempt.id, status: 'PENDING' },
    data: { status: 'ABANDONED', verifiedAt: now },
  });
  return 'abandoned';
}

/** Re-check every attempt on an order that is still waiting to hear back. */
export async function reconcileOpenAttempts(orderId: string): Promise<void> {
  const open = await prisma.orderPayment.findMany({
    where: { orderId, status: 'PENDING' },
    select: { reference: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  for (const { reference } of open) {
    await reconcilePayment(reference);
  }
}

/* ---------------- reading ---------------- */

export interface OrderPaymentState {
  /** the shopper can (still) pay this order online */
  canPay: boolean;
  /** the latest attempt didn't go through — say so, and offer another go */
  lastAttemptFailed: boolean;
  /** 'payment-timeout' | 'merchant' when the order was cancelled */
  cancelReason: string | null;
}

export async function getOrderPaymentState(orderId: string): Promise<OrderPaymentState> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      cancelReason: true,
      payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!order) return { canPay: false, lastAttemptFailed: false, cancelReason: null };

  const canPay =
    order.paymentMethod === ONLINE_PAYMENT_METHOD &&
    order.paymentStatus === 'AWAITING_PAYMENT' &&
    (PAYABLE_ORDER_STATUSES as readonly string[]).includes(order.status);

  const last = order.payments[0]?.status;
  return {
    canPay,
    lastAttemptFailed: canPay && (last === 'FAILED' || last === 'ABANDONED'),
    cancelReason: order.status === 'CANCELLED' ? order.cancelReason : null,
  };
}

/** Where to send the shopper back to, once the provider returns them. */
export async function paymentReturn(
  reference: string,
): Promise<{ returnUrl: string; nativeApp: boolean; nativeAppScheme: string | null } | null> {
  const attempt = await prisma.orderPayment.findUnique({
    where: { reference },
    select: { returnUrl: true, nativeApp: true, nativeAppScheme: true },
  });
  return attempt ?? null;
}
