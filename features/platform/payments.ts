'use server';

/*
 * features/platform/payments.ts
 *
 * Money problems, for platform staff (ROADMAP 11.6). Paystack settles to each
 * merchant directly (10.1), so there are no payout runs to show — only what
 * went wrong on the way:
 *   - stuck: storefront payment attempts that never confirmed;
 *   - mismatched: Paystack says paid, but a different amount or to a
 *     different subaccount (10.4) — never treated as payment;
 *   - unmatched: Paystack payments or disputes whose reference is nothing of
 *     ours (recorded by the webhook, lib/payments/unmatched.ts);
 *   - disputes: chargebacks still open (10.5);
 *   - payouts: merchants whose Paystack subaccount needs attention (10.3).
 * Refunds are paused (10.7), so there is no refund queue.
 *
 * Nothing here moves money. "Check with Paystack" asks Paystack and settles
 * exactly as the webhook would; "Mark reviewed" records what staff found.
 */
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { recheckPaymentForStaff } from '@/lib/storefront/checkout/payment-service';
import { UNPAID_ORDER_HOLD_MINUTES } from '@/lib/storefront/orders/lifecycle';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };
export type PaymentTab = 'stuck' | 'mismatched' | 'unmatched' | 'disputes' | 'payouts';

export interface PaymentCounts {
  stuck: number;
  mismatched: number;
  unmatched: number;
  disputes: number;
  payouts: number;
}

export interface StuckRow {
  id: string;
  reference: string;
  amount: number;
  createdAt: Date;
  shop: { id: string; name: string };
  orderReference: string;
  orderStatus: string;
}

export interface MismatchRow extends StuckRow {
  expectedSubaccount: string | null;
  reportedAmount: number | null;
  reportedCurrency: string | null;
  reportedSubaccount: string | null;
  platformShare: number | null;
  verifiedAt: Date | null;
  review: { at: Date; note: string | null } | null;
}

export interface UnmatchedRow {
  id: string;
  kind: string;
  event: string;
  reference: string;
  amount: number | null;
  currency: string | null;
  subaccountCode: string | null;
  /** the shop that subaccount belongs to, if it's one of ours */
  shop: { id: string; name: string } | null;
  customerEmail: string | null;
  createdAt: Date;
  resolution: { at: Date; note: string | null } | null;
}

export interface DisputeRow {
  id: string;
  status: string;
  category: string | null;
  amount: number;
  currency: string;
  dueAt: Date | null;
  createdAt: Date;
  shop: { id: string; name: string };
  orderReference: string;
  paymentReference: string;
}

export interface PayoutRow {
  shop: { id: string; name: string };
  businessName: string | null;
  setupStatus: string;
  setupError: string | null;
  subaccountCode: string | null;
  updatedAt: Date;
}

export type PaymentPage =
  | { tab: 'stuck'; rows: StuckRow[]; total: number; page: number; pageSize: number; counts: PaymentCounts }
  | { tab: 'mismatched'; rows: MismatchRow[]; total: number; page: number; pageSize: number; counts: PaymentCounts }
  | { tab: 'unmatched'; rows: UnmatchedRow[]; total: number; page: number; pageSize: number; counts: PaymentCounts }
  | { tab: 'disputes'; rows: DisputeRow[]; total: number; page: number; pageSize: number; counts: PaymentCounts }
  | { tab: 'payouts'; rows: PayoutRow[]; total: number; page: number; pageSize: number; counts: PaymentCounts };

const PAGE_SIZE = 25;
const DAY = 24 * 60 * 60 * 1000;

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') return { success: false, error: 'Only platform staff can do this' };
  console.error(`[platform/payments] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** Still pending past the unpaid-order hold, in the last 30 days — older ones have been swept. */
const stuckWhere = (now: Date) => ({
  status: 'PENDING' as const,
  provider: 'paystack',
  createdAt: { lt: new Date(now.getTime() - UNPAID_ORDER_HOLD_MINUTES * 60_000), gt: new Date(now.getTime() - 30 * DAY) },
});
const mismatchWhere = { status: 'MISMATCH' as const, reviewedAt: null };
const unmatchedWhere = { resolvedAt: null };
const disputeWhere = { status: { not: 'resolved' } };
const payoutWhere = { setupStatus: { in: ['ACTION_REQUIRED', 'DISABLED'] as ('ACTION_REQUIRED' | 'DISABLED')[] } };

async function counts(now: Date): Promise<PaymentCounts> {
  const [stuck, mismatched, unmatched, disputes, payouts] = await Promise.all([
    prisma.orderPayment.count({ where: stuckWhere(now) }),
    prisma.orderPayment.count({ where: mismatchWhere }),
    prisma.unmatchedPayment.count({ where: unmatchedWhere }),
    prisma.paymentDispute.count({ where: disputeWhere }),
    prisma.merchantPaymentAccount.count({ where: payoutWhere }),
  ]);
  return { stuck, mismatched, unmatched, disputes, payouts };
}

/** What needs a human — the console sidebar's badge. Stuck payments aren't counted: most are abandoned checkouts. */
export async function paymentAttentionCount(): Promise<number> {
  await requirePlatformStaff();
  const c = await counts(new Date());
  return c.mismatched + c.unmatched + c.disputes + c.payouts;
}

export async function getPaymentCounts(): Promise<ActionResult<PaymentCounts>> {
  try {
    await requirePlatformStaff();
    return { success: true, data: await counts(new Date()) };
  } catch (error) {
    return denied(error, 'We couldn’t load the payment problems');
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function listPaymentProblems(params: { tab?: PaymentTab; page?: number }): Promise<ActionResult<PaymentPage>> {
  try {
    await requirePlatformStaff();
    const now = new Date();
    const tab = params.tab ?? 'mismatched';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const skip = (page - 1) * PAGE_SIZE;
    const c = await counts(now);
    const base = { page, pageSize: PAGE_SIZE, counts: c };
    const paymentInclude = {
      organization: { select: { id: true, name: true } },
      order: { select: { reference: true, status: true } },
    } as const;

    if (tab === 'stuck' || tab === 'mismatched') {
      const where = tab === 'stuck' ? stuckWhere(now) : mismatchWhere;
      const rows = await prisma.orderPayment.findMany({
        where,
        orderBy: { createdAt: tab === 'stuck' ? 'asc' : 'desc' },
        skip,
        take: PAGE_SIZE,
        include: paymentInclude,
      });
      const common = (p: (typeof rows)[number]): StuckRow => ({
        id: p.id,
        reference: p.reference,
        amount: Number(p.amount),
        createdAt: p.createdAt,
        shop: p.organization,
        orderReference: p.order.reference,
        orderStatus: p.order.status,
      });
      if (tab === 'stuck') return { success: true, data: { tab, rows: rows.map(common), total: c.stuck, ...base } };
      return {
        success: true,
        data: {
          tab,
          total: c.mismatched,
          ...base,
          rows: rows.map((p) => {
            // What Paystack reported, from its own verify response (kept on the attempt).
            const raw = (p.providerPayload ?? {}) as Record<string, unknown>;
            const sub = (raw.subaccount ?? {}) as Record<string, unknown>;
            const split = (raw.fees_split ?? {}) as Record<string, unknown>;
            const amount = num(raw.amount);
            return {
              ...common(p),
              expectedSubaccount: p.subaccountCode,
              reportedAmount: amount === null ? null : amount / 100,
              reportedCurrency: typeof raw.currency === 'string' ? raw.currency : null,
              reportedSubaccount: typeof sub.subaccount_code === 'string' ? sub.subaccount_code : null,
              platformShare: num(split.integration) === null ? null : num(split.integration)! / 100,
              verifiedAt: p.verifiedAt,
              review: p.reviewedAt ? { at: p.reviewedAt, note: p.reviewNote } : null,
            };
          }),
        },
      };
    }

    if (tab === 'unmatched') {
      const rows = await prisma.unmatchedPayment.findMany({ where: unmatchedWhere, orderBy: { createdAt: 'desc' }, skip, take: PAGE_SIZE });
      const codes = rows.map((r) => r.subaccountCode).filter((x): x is string => Boolean(x));
      const owners = codes.length
        ? await prisma.merchantPaymentAccount.findMany({
            where: { paystackSubaccountCode: { in: codes } },
            select: { paystackSubaccountCode: true, organization: { select: { id: true, name: true } } },
          })
        : [];
      return {
        success: true,
        data: {
          tab,
          total: c.unmatched,
          ...base,
          rows: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            event: r.event,
            reference: r.reference,
            amount: r.amount === null ? null : Number(r.amount),
            currency: r.currency,
            subaccountCode: r.subaccountCode,
            shop: owners.find((o) => o.paystackSubaccountCode === r.subaccountCode)?.organization ?? null,
            customerEmail: r.customerEmail,
            createdAt: r.createdAt,
            resolution: r.resolvedAt ? { at: r.resolvedAt, note: r.resolutionNote } : null,
          })),
        },
      };
    }

    if (tab === 'disputes') {
      const rows = await prisma.paymentDispute.findMany({
        where: disputeWhere,
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: PAGE_SIZE,
        include: {
          organization: { select: { id: true, name: true } },
          order: { select: { reference: true } },
          payment: { select: { reference: true } },
        },
      });
      return {
        success: true,
        data: {
          tab,
          total: c.disputes,
          ...base,
          rows: rows.map((d) => ({
            id: d.id,
            status: d.status,
            category: d.category,
            amount: Number(d.amount),
            currency: d.currency,
            dueAt: d.dueAt,
            createdAt: d.createdAt,
            shop: d.organization,
            orderReference: d.order.reference,
            paymentReference: d.payment.reference,
          })),
        },
      };
    }

    const rows = await prisma.merchantPaymentAccount.findMany({
      where: payoutWhere,
      orderBy: { updatedAt: 'asc' },
      skip,
      take: PAGE_SIZE,
      include: { organization: { select: { id: true, name: true } } },
    });
    return {
      success: true,
      data: {
        tab: 'payouts',
        total: c.payouts,
        ...base,
        rows: rows.map((a) => ({
          shop: a.organization,
          businessName: a.businessName,
          setupStatus: a.setupStatus,
          setupError: a.setupError,
          subaccountCode: a.paystackSubaccountCode,
          updatedAt: a.updatedAt,
        })),
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the payment problems');
  }
}

const RECHECK_MESSAGE: Record<string, string> = {
  paid: 'Paystack has the payment — the order is now paid and the shopper has been told.',
  'already-paid': 'It was already settled.',
  pending: 'Paystack still has it as pending. Check again later.',
  failed: 'Paystack says it failed or was abandoned — recorded.',
  mismatch: 'Paystack says paid, but not the amount or subaccount we asked for. It’s now under Mismatched.',
  abandoned: 'Paystack has no record of it — the shopper never reached the payment page. Closed as abandoned.',
  'unknown-reference': 'There’s no such payment attempt.',
  unverifiable: 'This is an old Squad payment; there’s nobody left to ask.',
  error: 'Paystack couldn’t be reached. Try again in a minute.',
};

/** "Check with Paystack": settle a payment that never confirmed, exactly as the webhook would. */
export async function checkStuckPayment(paymentId: string): Promise<ActionResult<{ outcome: string; message: string }>> {
  try {
    await requirePlatformStaff();
    const attempt = await prisma.orderPayment.findUnique({ where: { id: paymentId }, select: { reference: true } });
    if (!attempt) return { success: false, error: 'There’s no such payment attempt.' };
    const outcome = await recheckPaymentForStaff(attempt.reference, UNPAID_ORDER_HOLD_MINUTES);
    return { success: true, data: { outcome, message: RECHECK_MESSAGE[outcome] ?? 'Checked.' } };
  } catch (error) {
    return denied(error, 'We couldn’t check with Paystack');
  }
}

function cleanNote(note: string): string | { error: string } {
  const text = String(note ?? '').trim();
  if (text.length < 5) return { error: 'Say what you found in a few words.' };
  if (text.length > 1000) return { error: 'Keep the note to 1,000 characters.' };
  return text;
}

/** A mismatch looked into: what staff found. Doesn't change the payment or the order. */
export async function markPaymentReviewed(paymentId: string, note: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const text = cleanNote(note);
    if (typeof text !== 'string') return { success: false, error: text.error };
    const updated = await prisma.orderPayment.updateMany({
      where: { id: paymentId, status: 'MISMATCH', reviewedAt: null },
      data: { reviewedAt: new Date(), reviewedById: staff.userId, reviewNote: text },
    });
    if (updated.count === 0) return { success: false, error: 'It’s already been reviewed, or isn’t a mismatch.' };
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t save that');
  }
}

/** An unmatched payment or dispute looked into and dealt with outside the app. */
export async function resolveUnmatchedPayment(id: string, note: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const text = cleanNote(note);
    if (typeof text !== 'string') return { success: false, error: text.error };
    const updated = await prisma.unmatchedPayment.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: staff.userId, resolutionNote: text },
    });
    if (updated.count === 0) return { success: false, error: 'It’s already been dealt with.' };
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t save that');
  }
}
