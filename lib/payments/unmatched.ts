/*
 * lib/payments/unmatched.ts
 *
 * A Paystack payment or dispute that matched nothing of ours (ROADMAP 11.6) —
 * recorded for platform staff, never credited anywhere. The webhook's
 * signature has already been checked. Idempotent on (kind, reference):
 * Paystack's retries update the one row.
 */
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const minor = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v / 100 : null);

export async function recordUnmatched(kind: 'charge' | 'dispute', event: string, data: Raw): Promise<'recorded' | 'no-reference'> {
  const tx = kind === 'dispute' ? ((data.transaction ?? {}) as Raw) : data;
  const reference = str(tx.reference);
  if (!reference) return 'no-reference';
  const subaccount = (tx.subaccount ?? {}) as Raw;
  const customer = (tx.customer ?? data.customer ?? {}) as Raw;
  const amount = minor(tx.amount);
  const fields = {
    event,
    amount: amount === null ? null : new Prisma.Decimal(amount),
    currency: str(tx.currency),
    subaccountCode: str(subaccount.subaccount_code),
    customerEmail: str(customer.email),
    payload: data as Prisma.InputJsonValue,
  };
  await prisma.unmatchedPayment.upsert({
    where: { kind_reference: { kind, reference } },
    create: { kind, reference, ...fields },
    update: fields,
  });
  console.warn(`[paystack webhook] ${event} for ${reference} matched nothing of ours — recorded for staff.`);
  return 'recorded';
}

/** Whether a charge.success is a subscription renewal: Paystack gives those their own reference, with the plan. */
export function isSubscriptionCharge(data: Raw): boolean {
  const plan = data.plan;
  if (typeof plan === 'string') return plan.trim().length > 0;
  return Boolean(plan && typeof plan === 'object' && str((plan as Raw).plan_code));
}
