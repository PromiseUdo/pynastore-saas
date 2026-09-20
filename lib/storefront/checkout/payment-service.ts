/*
 * lib/storefront/checkout/payment-service.ts
 *
 * Paying for an online order. Server only.
 *
 * THE FLOW
 *
 *   place order ─▶ startOrderPayment() ─▶ Squad /transaction/initiate
 *                        │                       └─ checkout_url
 *                        └─ OrderPayment row (PENDING, our reference)
 *   shopper pays on Squad's page
 *   Squad ─▶ /api/payments/squad/callback (the browser)  ┐
 *   Squad ─▶ /api/payments/squad/webhook  (server)       ├─▶ reconcilePayment()
 *   confirmation page load (safety net)                  ┘      └─ Squad /verify
 *
 * THE ONE RULE: an order becomes PAID only because Squad's verify endpoint,
 * called here with our secret key, said so — for the amount and currency we
 * asked for. The callback's query string and the webhook's body are only ever
 * treated as "go and check this reference". Three doors, one check, and the
 * check is idempotent, so it doesn't matter which arrives first or how often.
 *
 * LATE PAYMENTS. An unpaid order gives its stock back after a while
 * (orders/lifecycle.ts). If the money arrives after that, the order is
 * revived when the stock can be held again; if it can't, the order stays
 * cancelled but PAID, the shopper is told to arrange a refund, and the
 * merchant sees exactly that combination on the order.
 *
 * ATTEMPTS. Squad refuses a reused transaction reference, so every "Pay now"
 * is its own OrderPayment row with its own reference. The order keeps its
 * shopper-facing ORD- reference throughout.
 *
 * Money: the order stores major units; Squad takes minor units (kobo).
 */
import { randomBytes } from 'crypto';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  initiateTransaction,
  isSquadConfigured,
  verifyTransaction,
  type SquadTransaction,
} from '@/lib/payments/squad';
import { OutOfStockError, reReserveOrderStock } from '../orders/stock';
import { reclaimDiscountUse } from '../discounts/usage';
import { notifyShopper } from '../orders/notifications';

export const SQUAD_PROVIDER = 'squad';

/** Orders in these states may still be paid online. */
const PAYABLE_ORDER_STATUSES = ['PENDING', 'CONFIRMED'] as const;

/** Major-unit Decimal → integer minor units, without float drift. */
function toMinor(amount: Prisma.Decimal): number {
  return amount.times(100).toDecimalPlaces(0).toNumber();
}

/**
 * Our transaction reference: the order reference, for a human reading the
 * Squad dashboard, plus randomness, because each attempt needs its own.
 */
function attemptReference(orderReference: string): string {
  return `${orderReference}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

/* ---------------- starting ---------------- */

export type StartPaymentResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; reason: 'already-paid' | 'not-payable' | 'unavailable' };

/**
 * Open a Squad payment for an order and return where to send the shopper.
 *
 * `origin` is the public origin the shopper is browsing (their store's own
 * host), so Squad returns them to the store they bought from. `returnPath`
 * is the store-relative confirmation page to land on afterwards.
 */
export async function startOrderPayment(input: {
  organizationId: string;
  orderId: string;
  origin: string;
  returnPath: string;
  /** started inside the phone app — see the callback route */
  nativeApp?: boolean;
}): Promise<StartPaymentResult> {
  if (!isSquadConfigured()) {
    console.error('[payments] SQUADCO_SECRET_KEY is not set; cannot start a payment.');
    return { ok: false, reason: 'unavailable' };
  }

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
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
  if (!order) return { ok: false, reason: 'not-payable' };

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
    order.paymentMethod !== SQUAD_PROVIDER ||
    fresh.paymentStatus !== 'AWAITING_PAYMENT' ||
    !(PAYABLE_ORDER_STATUSES as readonly string[]).includes(fresh.status)
  ) {
    return { ok: false, reason: 'not-payable' };
  }

  const reference = attemptReference(order.reference);
  const returnUrl = `${input.origin}${input.returnPath}`;

  const attempt = await prisma.orderPayment.create({
    data: {
      organizationId: input.organizationId,
      orderId: order.id,
      provider: SQUAD_PROVIDER,
      reference,
      amount: order.totalAmount,
      currency: order.currency,
      returnUrl,
      nativeApp: Boolean(input.nativeApp),
    },
    select: { id: true },
  });

  try {
    const { checkoutUrl } = await initiateTransaction({
      amount: toMinor(order.totalAmount),
      currency: order.currency,
      email: order.email,
      customerName: `${order.firstName} ${order.lastName}`.trim() || undefined,
      transactionRef: reference,
      callbackUrl: `${input.origin}/api/payments/squad/callback?ref=${encodeURIComponent(reference)}`,
      metadata: { orderReference: order.reference },
    });

    await prisma.orderPayment.update({ where: { id: attempt.id }, data: { checkoutUrl } });
    return { ok: true, checkoutUrl };
  } catch (error) {
    console.error(`[payments] Could not start Squad payment for ${order.reference}:`, error);
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
  | 'error';

/**
 * Bring one attempt in line with what Squad says. Safe to call any number of
 * times, from anywhere, in any order: it only ever moves an attempt out of
 * PENDING once, and an order into PAID once.
 */
export async function reconcilePayment(reference: string): Promise<ReconcileOutcome> {
  const attempt = await prisma.orderPayment.findUnique({
    where: { reference },
    select: { id: true, status: true, amount: true, currency: true, orderId: true },
  });
  if (!attempt) return 'unknown-reference';
  if (attempt.status === 'SUCCESS') return 'already-paid';

  let transaction: SquadTransaction | null;
  try {
    transaction = await verifyTransaction(reference);
  } catch (error) {
    console.error(`[payments] Could not verify ${reference} with Squad:`, error);
    return 'error';
  }

  // Squad has no record yet: the shopper never reached its page.
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
  const expected = toMinor(attempt.amount);
  if (transaction.amount !== expected || transaction.currency.toUpperCase() !== attempt.currency.toUpperCase()) {
    console.error(
      `[payments] ${reference}: Squad reports ${transaction.amount} ${transaction.currency}, expected ${expected} ${attempt.currency}.`,
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
        gatewayRef: typeof transaction.raw.gateway_ref === 'string' ? transaction.raw.gateway_ref : null,
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
    order.paymentMethod === SQUAD_PROVIDER &&
    order.paymentStatus === 'AWAITING_PAYMENT' &&
    (PAYABLE_ORDER_STATUSES as readonly string[]).includes(order.status);

  const last = order.payments[0]?.status;
  return {
    canPay,
    lastAttemptFailed: canPay && (last === 'FAILED' || last === 'ABANDONED'),
    cancelReason: order.status === 'CANCELLED' ? order.cancelReason : null,
  };
}

/** Where to send the shopper back to, once Squad returns them. */
export async function paymentReturn(
  reference: string,
): Promise<{ returnUrl: string; nativeApp: boolean } | null> {
  const attempt = await prisma.orderPayment.findUnique({
    where: { reference },
    select: { returnUrl: true, nativeApp: true },
  });
  return attempt ?? null;
}
