'use server';

/*
 * features/settings/shop-wallet-payouts.ts
 *
 * Withdrawing from the shop wallet to the shop's bank (ROADMAP 20.7). Only the
 * shop's OWNER, signed in with two steps (ROADMAP 14.5: a password and a code,
 * or Google or Apple): this moves the shop's money out, and turning on
 * auto-withdraw asks for no code at EduPay, so these checks are its only guard. Everything else
 * — which account, whether a withdrawal is allowed — is decided in
 * lib/wallet/payouts.ts. Emailed codes go to EduPay and nowhere else: not into
 * the audit log, not back to the page.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getOrganizationContext } from '@/lib/organization';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { auth } from '@/lib/auth';
import { isStrongSignIn } from '@/lib/account-security/strong-sign-in';
import {
  cancelWithdrawal,
  confirmBankLink,
  confirmWithdrawal,
  saveAutoWithdraw,
  startBankLink,
  startWithdrawal,
  type ConfirmOutcome,
  type PayoutResult,
} from '@/lib/wallet/payouts';

export type PayoutActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string; field?: 'amount' | 'code' };

const NOT_OWNER: PayoutActionResult<never> = { success: false, error: 'Only the shop’s owner can do this.' };
const WEAK_SIGN_IN: PayoutActionResult<never> = {
  success: false,
  error: 'For your security, this needs two-step sign-in. Turn it on in Settings → Your account, or sign in with Google, then try again.',
};
const TOO_MANY: PayoutActionResult<never> = { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' };
const PAGE = '/settings/payments/wallet';

async function owner() {
  const ctx = await getOrganizationContext();
  const { role } = ctx.membership;
  return role.isSystem && role.name === SYSTEM_ROLES.OWNER.name ? ctx : null;
}

type Owner = NonNullable<Awaited<ReturnType<typeof owner>>>;

async function run<T>(
  label: string,
  limit: { key: string; max: number } | null,
  work: (ctx: Owner) => Promise<PayoutResult<T>>,
  audit?: (ctx: Owner, data: T) => { action: string; entityType: string; entityId: string; metadata?: Record<string, string | number | boolean> },
  { strong = true }: { strong?: boolean } = {},
): Promise<PayoutActionResult<T>> {
  try {
    const ctx = await owner();
    if (!ctx) return NOT_OWNER;
    // Anything that moves money, or where it goes, needs a session that passed two steps.
    if (strong && !isStrongSignIn((await auth())?.signInMethod)) return WEAK_SIGN_IN;
    if (limit && !(await checkRateLimit(`${limit.key}:${ctx.organization.id}`, limit.max, 15 * 60 * 1000))) return TOO_MANY;

    const result = await work(ctx);
    if (!result.ok) return { success: false, error: result.error, field: result.field };
    if (audit) await createAuditLog({ organizationId: ctx.organization.id, userId: ctx.userId, ...audit(ctx, result.data) });
    revalidatePath(PAGE);
    return { success: true, data: result.data };
  } catch (error) {
    console.error(`[settings] ${label} failed:`, error instanceof Error ? error.message : 'unknown error');
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}

/** Step one of connecting the verified account: EduPay emails a code. */
export async function startBankLinkAction(): Promise<PayoutActionResult<void>> {
  return run('Connecting a bank account', { key: 'wallet-bank-link', max: 5 }, (ctx) => startBankLink(ctx.organization.id));
}

export async function confirmBankLinkAction(code: string): Promise<PayoutActionResult<void>> {
  return run(
    'Confirming a bank account',
    { key: 'wallet-bank-code', max: 10 },
    (ctx) => confirmBankLink(ctx.organization.id, String(code ?? '').trim()),
    (ctx) => ({ action: 'settings.shop_wallet.bank_account_added', entityType: 'ShopWallet', entityId: ctx.organization.id }),
  );
}

/** Step one of a withdrawal: nothing moves, EduPay emails a code. */
export async function startWithdrawalAction(rawAmount: string): Promise<PayoutActionResult<{ id: string; amount: number }>> {
  return run(
    'Starting a withdrawal',
    { key: 'wallet-withdraw', max: 10 },
    (ctx) => startWithdrawal({ organizationId: ctx.organization.id, rawAmount: String(rawAmount ?? ''), performedById: ctx.userId }),
    (_ctx, data) => ({ action: 'settings.shop_wallet.withdrawal_requested', entityType: 'WalletWithdrawal', entityId: data.id, metadata: { amount: data.amount } }),
  );
}

/** Step two. `checking`: EduPay didn't clearly answer — it's being looked into, and must not be repeated. */
export async function confirmWithdrawalAction(code: string): Promise<PayoutActionResult<ConfirmOutcome>> {
  return run(
    'Confirming a withdrawal',
    { key: 'wallet-withdraw-code', max: 10 },
    (ctx) => confirmWithdrawal({ organizationId: ctx.organization.id, code: String(code ?? '').trim(), performedById: ctx.userId }),
    (ctx, outcome) => ({
      action: 'settings.shop_wallet.withdrawal_confirmed',
      entityType: 'ShopWallet',
      entityId: ctx.organization.id,
      metadata: { confirmed: outcome === 'sent' },
    }),
  );
}

export async function cancelWithdrawalAction(): Promise<PayoutActionResult<void>> {
  return run(
    'Cancelling a withdrawal',
    null,
    (ctx) => cancelWithdrawal(ctx.organization.id),
    (ctx) => ({ action: 'settings.shop_wallet.withdrawal_cancelled', entityType: 'ShopWallet', entityId: ctx.organization.id }),
    // Cancelling moves nothing.
    { strong: false },
  );
}

const AutoSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time of day.'),
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    // To the 28th: every month has one.
    dayOfMonth: z.number().int().min(1).max(28).nullable(),
    minAmount: z.number().int().min(100, 'The smallest withdrawal is ₦100.').max(1_000_000_000),
    maxAmount: z.number().int().positive().max(1_000_000_000).nullable(),
    reserve: z.number().int().min(0).max(1_000_000_000),
    notifyOnRun: z.boolean(),
  })
  .refine((v) => v.maxAmount === null || v.maxAmount >= v.minAmount, { message: 'The most per withdrawal can’t be below the least.' })
  .refine((v) => v.frequency !== 'weekly' || v.dayOfWeek !== null, { message: 'Choose a day of the week.' })
  .refine((v) => v.frequency !== 'monthly' || v.dayOfMonth !== null, { message: 'Choose a day of the month.' });

export async function saveAutoWithdrawAction(input: z.input<typeof AutoSchema>): Promise<PayoutActionResult<void>> {
  const parsed = AutoSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the highlighted fields.' };
  const { time, ...rest } = parsed.data;
  return run(
    'Saving auto-withdraw',
    { key: 'wallet-auto-withdraw', max: 20 },
    (ctx) => saveAutoWithdraw(ctx.organization.id, { ...rest, time: `${time}:00` }),
    (ctx) => ({
      action: 'settings.shop_wallet.auto_withdraw_updated',
      entityType: 'ShopWallet',
      entityId: ctx.organization.id,
      metadata: { enabled: rest.enabled, frequency: rest.frequency, minAmount: rest.minAmount, reserve: rest.reserve },
    }),
  );
}
