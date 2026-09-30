'use server';

/*
 * features/sales/payments.ts
 *
 * The merchant's online payments (ROADMAP 10.6): what each customer paid, what
 * Paystack took as its fee, and what the merchant receives — AS PAYSTACK
 * REPORTED THEM on the verified transaction (`fees_split`, stored by
 * reconcilePayment in 10.4). None of it is our arithmetic.
 *
 * There is no balance, wallet or "owed by MansaaS" here, because there is
 * none: Paystack settles each payment straight to the shop's own bank account
 * through its subaccount, and the platform takes no share (10.1). Paystack
 * doesn't report settlement per subaccount (10.13), so this doesn't pretend
 * to know when a payment reached the bank.
 *
 * Only successful attempts are payments. Filters live in the URL and become
 * the query (AGENTS §3); the browser only ever holds the page it was given.
 * Viewing needs `sales.view`, the same as the orders the payments belong to.
 */
import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { maskAccountNumber } from '@/lib/payments/payment-setup';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export type PaymentRange = '7d' | '30d' | '90d' | 'all';
export type PaymentView = 'all' | 'disputed';

export interface PaymentFilters {
  range?: string;
  view?: string;
  q?: string;
  page?: number;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  orderReference: string;
  customerName: string | null;
  paidAt: string;
  /** 'paystack' now; 'squad' for payments taken before the move (ROADMAP 10.9) */
  provider: string;
  channel: string | null;
  currency: string;
  /** what the customer paid */
  amount: number;
  /** Paystack's fee, which the merchant bears — null on a Squad-era payment */
  feeAmount: number | null;
  /** what settles to the merchant's bank, as Paystack reported it */
  merchantAmount: number | null;
  /** Paystack's transaction id */
  providerReference: string | null;
  /** refunds the merchant has recorded against the order */
  refunded: number;
  /** the latest chargeback's status, if the customer's bank disputed it */
  disputeStatus: string | null;
}

export interface PaymentList {
  rows: PaymentRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  range: PaymentRange;
  view: PaymentView;
  /** the whole filtered set, not just this page */
  totals: { count: number; paid: number; fees: number; received: number };
  /** every successful online payment this store has ever had */
  historySize: number;
  /** where Paystack settles to now, masked; null before payouts are set up */
  settlement: { bankName: string | null; accountNumber: string; accountName: string | null } | null;
  currency: string;
}

const PER_PAGE = 25;
const EXPORT_CAP = 5000;
const RANGE_DAYS: Record<Exclude<PaymentRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

function parseRange(value: string | undefined): PaymentRange {
  return value === '7d' || value === '90d' || value === 'all' ? value : '30d';
}

function whereFor(organizationId: string, filters: PaymentFilters): {
  where: Prisma.OrderPaymentWhereInput;
  range: PaymentRange;
  view: PaymentView;
} {
  const range = parseRange(filters.range);
  const view: PaymentView = filters.view === 'disputed' ? 'disputed' : 'all';
  const q = filters.q?.trim().slice(0, 100);
  const where: Prisma.OrderPaymentWhereInput = {
    organizationId,
    status: 'SUCCESS',
    ...(range !== 'all' ? { verifiedAt: { gte: new Date(Date.now() - RANGE_DAYS[range] * 86_400_000) } } : {}),
    ...(view === 'disputed' ? { disputes: { some: {} } } : {}),
    ...(q
      ? {
          OR: [
            { order: { reference: { contains: q, mode: 'insensitive' } } },
            { reference: { contains: q, mode: 'insensitive' } },
            { gatewayRef: { contains: q } },
            { order: { email: { contains: q, mode: 'insensitive' } } },
            { order: { lastName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  return { where, range, view };
}

const ROW_SELECT = {
  id: true,
  provider: true,
  channel: true,
  currency: true,
  amount: true,
  feeAmount: true,
  merchantAmount: true,
  gatewayRef: true,
  verifiedAt: true,
  createdAt: true,
  order: {
    select: {
      id: true,
      reference: true,
      firstName: true,
      lastName: true,
      refunds: { select: { amount: true } },
    },
  },
  disputes: { select: { status: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.OrderPaymentSelect;

type RowRecord = Prisma.OrderPaymentGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(p: RowRecord): PaymentRow {
  const name = `${p.order.firstName ?? ''} ${p.order.lastName ?? ''}`.trim();
  return {
    id: p.id,
    orderId: p.order.id,
    orderReference: p.order.reference,
    customerName: name || null,
    paidAt: (p.verifiedAt ?? p.createdAt).toISOString(),
    provider: p.provider,
    channel: p.channel,
    currency: p.currency,
    amount: Number(p.amount),
    feeAmount: p.feeAmount === null ? null : Number(p.feeAmount),
    merchantAmount: p.merchantAmount === null ? null : Number(p.merchantAmount),
    providerReference: p.gatewayRef,
    refunded: p.order.refunds.reduce((sum, r) => sum + Number(r.amount), 0),
    disputeStatus: p.disputes[0]?.status ?? null,
  };
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to see payments' };
  }
  console.error(`[payments] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function listOnlinePayments(filters: PaymentFilters = {}): Promise<ActionResult<PaymentList>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;
    const { where, range, view } = whereFor(organizationId, filters);
    const requested = Math.max(1, Math.floor(filters.page ?? 1));

    const [total, sums, historySize, account] = await Promise.all([
      prisma.orderPayment.count({ where }),
      prisma.orderPayment.aggregate({
        where,
        _sum: { amount: true, feeAmount: true, merchantAmount: true },
      }),
      prisma.orderPayment.count({ where: { organizationId, status: 'SUCCESS' } }),
      prisma.merchantPaymentAccount.findUnique({
        where: { organizationId },
        select: { settlementBankName: true, settlementAccountNumber: true, settlementAccountName: true, paystackSubaccountCode: true },
      }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
    const page = Math.min(requested, pageCount);
    const records = await prisma.orderPayment.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ verifiedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    });

    return {
      success: true,
      data: {
        rows: records.map(toRow),
        total,
        page,
        perPage: PER_PAGE,
        pageCount,
        range,
        view,
        totals: {
          count: total,
          paid: Number(sums._sum.amount ?? 0),
          fees: Number(sums._sum.feeAmount ?? 0),
          received: Number(sums._sum.merchantAmount ?? 0),
        },
        historySize,
        settlement:
          account?.paystackSubaccountCode && account.settlementAccountNumber
            ? {
                bankName: account.settlementBankName,
                accountNumber: maskAccountNumber(account.settlementAccountNumber),
                accountName: account.settlementAccountName,
              }
            : null,
        currency: ctx.organization.currency,
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your payments');
  }
}

/** Every payment the filters match (up to 5,000), for the CSV — not just the page on screen. */
export async function exportOnlinePayments(filters: PaymentFilters = {}): Promise<ActionResult<PaymentRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const { where } = whereFor(ctx.organization.id, filters);
    const records = await prisma.orderPayment.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ verifiedAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_CAP,
    });
    return { success: true, data: records.map(toRow) };
  } catch (error) {
    return failure(error, 'We couldn’t prepare the download');
  }
}
