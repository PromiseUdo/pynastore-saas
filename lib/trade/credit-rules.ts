/*
 * lib/trade/credit-rules.ts
 *
 * Pay on account (ROADMAP 21.5), the rules. Pure and client-safe: checkout
 * greys the option out with the same reason the server refuses it with
 * (lib/trade/credit.ts → placeOrder). Money is minor units here, like the
 * rest of the storefront.
 */
import { formatMoney } from '@/lib/storefront/format';

/** What a trade buyer's credit looks like right now, as checkout needs it. */
export interface AccountStanding {
  /** how long they have to pay an order placed today */
  days: number;
  /** that date, ISO */
  dueDate: string;
  /** the most they may owe at once; null = no limit */
  creditLimit: number | null;
  /** owed now, across on-account orders and unpaid invoices */
  owed: number;
  /** of which past its due date */
  overdue: number;
}

export type AccountAvailability = { ok: true } | { ok: false; reason: string };

/**
 * May this order go on account? Not while anything is overdue — that's
 * settled first — and not past the credit limit, counting what's owed
 * already.
 */
export function accountAvailability(standing: AccountStanding, orderTotal: number, currency = 'NGN'): AccountAvailability {
  const money = (minor: number) => formatMoney(minor, currency);
  if (standing.overdue > 0) {
    return { ok: false, reason: `You have ${money(standing.overdue)} overdue. Pay that first, or pay for this order now.` };
  }
  if (standing.creditLimit !== null) {
    const left = Math.max(0, standing.creditLimit - standing.owed);
    if (orderTotal > left) {
      return {
        ok: false,
        reason:
          left > 0
            ? `This order is over what’s left of your credit (${money(left)}). Pay for it now, or make it smaller.`
            : `You’ve used all your credit (${money(standing.creditLimit)}). Pay what you owe, or pay for this order now.`,
      };
    }
  }
  return { ok: true };
}

/** The method id checkout and the order use. */
export const ON_ACCOUNT_METHOD_ID = 'account';

/** The days a merchant may give, and the most. */
export const MAX_ACCOUNT_DAYS = 365;

/** Reminders, in days relative to the due date: before it, the day after, a week after. */
export const ACCOUNT_REMINDERS = [
  { stage: 1, daysFromDue: -3 },
  { stage: 2, daysFromDue: 1 },
  { stage: 3, daysFromDue: 7 },
] as const;
