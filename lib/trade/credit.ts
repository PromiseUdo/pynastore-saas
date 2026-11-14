/*
 * lib/trade/credit.ts
 *
 * Pay on account (ROADMAP 21.5): a trade buyer's terms and what they owe.
 * Server only.
 *
 * A buyer's BALANCE is one figure from two places (Phase 21, decision 6):
 * their on-account orders not yet paid, plus their unpaid invoices (Sales →
 * Invoices) — because to them it's all money owed to the same shop. Every
 * read is scoped to the shop.
 *
 * Major units in the database; the standing checkout sees is minor units.
 */
import { prisma } from '@/lib/prisma';
import { getWholesaleSettings } from './accounts';
import type { AccountStanding } from './credit-rules';

export interface AccountTerms {
  days: number;
  /** major units; null = no limit */
  creditLimit: number | null;
}

/** Their terms, if they may pay on account here now: approved, given credit, wholesale on. */
export async function accountTerms(organizationId: string, customerId: string): Promise<AccountTerms | null> {
  const [settings, account, org] = await Promise.all([
    getWholesaleSettings(organizationId),
    prisma.tradeAccount.findFirst({
      where: { organizationId, customerId, status: 'APPROVED', onAccount: true },
      select: { accountDays: true, creditLimit: true },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { tradeAccountDays: true } }),
  ]);
  if (settings.mode === 'OFF' || !account) return null;
  return {
    days: account.accountDays ?? org?.tradeAccountDays ?? 14,
    creditLimit: account.creditLimit === null ? null : Number(account.creditLimit),
  };
}

export interface OpenItem {
  kind: 'order' | 'invoice';
  id: string;
  /** order reference or invoice number */
  number: string;
  issuedAt: string;
  dueAt: string | null;
  total: number;
  paid: number;
  owed: number;
  overdue: boolean;
  /** the buyer's copy: the order's confirmation token, or the invoice's public token */
  token: string | null;
}

export interface AccountBalance {
  /** major units */
  owed: number;
  overdue: number;
  items: OpenItem[];
}

const UNPAID_INVOICE = ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/** What they owe this shop, oldest first. */
export async function accountBalance(organizationId: string, customerId: string, now = new Date()): Promise<AccountBalance> {
  const [orders, invoices] = await Promise.all([
    prisma.order.findMany({
      where: { organizationId, customerId, paymentStatus: 'ON_ACCOUNT', status: { not: 'CANCELLED' } },
      orderBy: { placedAt: 'asc' },
      select: { id: true, reference: true, placedAt: true, accountDueAt: true, totalAmount: true, accountPaidAmount: true, confirmationToken: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId, customerId, status: { in: [...UNPAID_INVOICE] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, invoiceNumber: true, createdAt: true, sentAt: true, dueDate: true, totalAmount: true, paidAmount: true, publicToken: true },
    }),
  ]);

  const items: OpenItem[] = [
    ...orders.map((o) => {
      const total = Number(o.totalAmount);
      const paid = Number(o.accountPaidAmount);
      return {
        kind: 'order' as const,
        id: o.id,
        number: o.reference,
        issuedAt: o.placedAt.toISOString(),
        dueAt: o.accountDueAt?.toISOString() ?? null,
        total,
        paid,
        owed: Math.max(0, round(total - paid)),
        overdue: Boolean(o.accountDueAt && o.accountDueAt < now),
        token: o.confirmationToken,
      };
    }),
    ...invoices.map((i) => {
      const total = Number(i.totalAmount);
      const paid = Number(i.paidAmount);
      return {
        kind: 'invoice' as const,
        id: i.id,
        number: i.invoiceNumber,
        issuedAt: (i.sentAt ?? i.createdAt).toISOString(),
        dueAt: i.dueDate?.toISOString() ?? null,
        total,
        paid,
        owed: Math.max(0, round(total - paid)),
        overdue: Boolean(i.dueDate && i.dueDate < now),
        token: i.publicToken,
      };
    }),
  ]
    .filter((item) => item.owed > 0)
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));

  return {
    owed: round(items.reduce((sum, item) => sum + item.owed, 0)),
    overdue: round(items.filter((item) => item.overdue).reduce((sum, item) => sum + item.owed, 0)),
    items,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** The standing checkout shows (minor units), or null when they don't pay on account here. */
export async function accountStanding(organizationId: string, customerId: string, now = new Date()): Promise<AccountStanding | null> {
  const terms = await accountTerms(organizationId, customerId);
  if (!terms) return null;
  const balance = await accountBalance(organizationId, customerId, now);
  const minor = (major: number) => Math.round(major * 100);
  return {
    days: terms.days,
    dueDate: dueDateFrom(now, terms.days).toISOString(),
    creditLimit: terms.creditLimit === null ? null : minor(terms.creditLimit),
    owed: minor(balance.owed),
    overdue: minor(balance.overdue),
  };
}

/** The end of the day, Lagos time, `days` from now — "due by 14 Dec" means all of the 14th. */
export function dueDateFrom(from: Date, days: number): Date {
  const lagos = new Date(from.getTime() + 3_600_000); // UTC+1, no DST
  const end = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + days, 23, 59, 59, 999);
  return new Date(end - 3_600_000);
}
