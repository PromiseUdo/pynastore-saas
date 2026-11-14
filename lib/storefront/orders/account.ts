/*
 * lib/storefront/orders/account.ts
 *
 * An order on account (ROADMAP 21.5), after it's placed: the merchant
 * records what the buyer pays — part payments allowed — until it's paid,
 * and the buyer is reminded before and after the due date. Server only; the
 * admin action checks `sales.fulfillment.manage`.
 *
 * The platform holds no money (Phase 10): the buyer pays the merchant
 * directly, and these are the merchant's records of it. An order on account
 * ships like a paid one; once its payments cover the total it IS paid.
 */
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { ACCOUNT_REMINDERS } from '@/lib/trade/credit-rules';
import { notifyShopper } from './notifications';
import { formatMoney } from '@/lib/format';

export const ACCOUNT_PAYMENT_METHODS = {
  transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  other: 'Other',
} as const;
export type AccountPaymentMethod = keyof typeof ACCOUNT_PAYMENT_METHODS;

export type AccountPaymentResult = { ok: true; paid: boolean } | { ok: false; error: string };

/**
 * Record money the buyer paid towards an on-account order. Never more than
 * is left to pay; the payment that completes it makes the order PAID.
 */
export async function recordAccountPayment(input: {
  organizationId: string;
  orderId: string;
  /** major units */
  amount: number;
  method: string;
  reference?: string | null;
  receivedAt?: Date | null;
  userId: string | null;
}): Promise<AccountPaymentResult> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter the amount they paid.' };
  if (!(input.method in ACCOUNT_PAYMENT_METHODS)) return { ok: false, error: 'Choose how they paid.' };
  const receivedAt = input.receivedAt && !Number.isNaN(input.receivedAt.getTime()) ? input.receivedAt : new Date();
  if (receivedAt.getTime() > Date.now() + 60_000) return { ok: false, error: 'The date it arrived can’t be in the future.' };
  const reference = (input.reference ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null;

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    select: { id: true, status: true, paymentStatus: true, totalAmount: true, accountPaidAmount: true },
  });
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.paymentStatus !== 'ON_ACCOUNT') return { ok: false, error: 'This order isn’t on account.' };
  if (order.status === 'CANCELLED') return { ok: false, error: 'This order was cancelled.' };

  const left = Math.round((Number(order.totalAmount) - Number(order.accountPaidAmount)) * 100) / 100;
  if (amount > left) {
    return { ok: false, error: `That’s more than is left to pay (${formatMoney(left)}).` };
  }
  const paidInFull = amount >= left;
  const paidAmount = new Prisma.Decimal(order.accountPaidAmount).plus(amount);

  const recorded = await prisma.$transaction(async (tx) => {
    // On the amount it was read with: two people recording at once settle once each, in turn.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: 'ON_ACCOUNT', accountPaidAmount: order.accountPaidAmount, status: { not: 'CANCELLED' } },
      data: {
        accountPaidAmount: paidAmount,
        ...(paidInFull ? { paymentStatus: 'PAID' as const, paidAt: receivedAt } : {}),
      },
    });
    if (!claimed.count) return false;
    await tx.orderAccountPayment.create({
      data: {
        organizationId: input.organizationId,
        orderId: order.id,
        amount: new Prisma.Decimal(amount),
        method: input.method,
        reference,
        receivedAt,
        recordedById: input.userId,
      },
    });
    return true;
  });
  if (!recorded) return { ok: false, error: 'This order changed while you were looking at it. Refresh the page and try again.' };

  await createAuditLog({
    organizationId: input.organizationId,
    userId: input.userId,
    action: 'sales.order.account_payment',
    entityType: 'Order',
    entityId: order.id,
    metadata: { amount, method: input.method, reference, paidInFull },
  });
  await notifyShopper(order.id, paidInFull ? 'payment-received' : 'account-payment-recorded', { accountPaid: amount });
  return { ok: true, paid: paidInFull };
}

/**
 * Remind buyers about on-account orders: a few days before the due date,
 * the day after, and a week after — each once, and none once it's paid.
 * Run by the daily job (/api/cron/account-reminders).
 */
export async function remindAccountOrders(options: { organizationId?: string; now?: Date; limit?: number } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const store = options.organizationId ? { organizationId: options.organizationId } : {};
  let sent = 0;
  // Latest stage first, so an order already a week overdue gets that one, not "due soon".
  for (const { stage, daysFromDue } of [...ACCOUNT_REMINDERS].reverse()) {
    // Due on or before this: `daysFromDue` days from the due date has come.
    const dueBy = new Date(now.getTime() - daysFromDue * 86_400_000);
    const due = await prisma.order.findMany({
      where: {
        ...store,
        paymentStatus: 'ON_ACCOUNT',
        status: { not: 'CANCELLED' },
        accountReminders: { lt: stage },
        accountDueAt: { lte: dueBy },
      },
      select: { id: true, accountReminders: true },
      orderBy: { accountDueAt: 'asc' },
      take: options.limit ?? 100,
    });
    for (const order of due) {
      // Straight to this stage: a buyer is never sent the earlier ones late.
      const claimed = await prisma.order.updateMany({
        where: { id: order.id, accountReminders: order.accountReminders, paymentStatus: 'ON_ACCOUNT' },
        data: { accountReminders: stage },
      });
      if (!claimed.count) continue;
      await notifyShopper(order.id, stage === 1 ? 'account-due-soon' : 'account-overdue');
      sent += 1;
    }
  }
  return sent;
}
