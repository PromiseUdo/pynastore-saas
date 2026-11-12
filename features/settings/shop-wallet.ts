'use server';

/*
 * features/settings/shop-wallet.ts
 *
 * The shop wallet: creating and changing its PIN, and adding money to it
 * (ROADMAP 20.3). Needs `settings.edit`; the wallet is always this shop's,
 * from the session's organization, never named by the browser. PINs go to
 * EduPay and nowhere else — not into the audit log, not back to the page.
 *
 * Adding money isn't offered inside the business app, where nothing is
 * bought (19.3); it works from any browser, the business host included.
 */
import { revalidatePath } from 'next/cache';
import { getOrganizationContext } from '@/lib/organization';
import { PERMISSIONS, requirePermission } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { activeShopWalletIds } from '@/lib/wallet/shop';
import { changeWalletPin, createWalletPin, type PinFieldErrors, type PinOutcome } from '@/lib/wallet/pin';
import { MAX_TOP_UP, MIN_TOP_UP, checkTopUp, parseTopUpAmount, startTopUp, type TopUpStatus } from '@/lib/wallet/top-up';
import { formatMoney } from '@/lib/format';
import { NOT_IN_THE_APP, isBusinessAppRequest } from '@/lib/business-app/request';

export type ShopPinResult = { success: true } | { success: false; error: string; fieldErrors?: PinFieldErrors };

async function run(
  action: 'settings.shop_wallet.pin_created' | 'settings.shop_wallet.pin_changed',
  work: (ids: { uuid: string; uniqId: string }) => Promise<PinOutcome>,
): Promise<ShopPinResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const ids = await activeShopWalletIds(ctx.organization.id);
    if (!ids) return { success: false, error: 'Your shop wallet isn’t ready yet.' };
    if (!(await checkRateLimit(`wallet-pin:shop:${ctx.organization.id}`, 10, 15 * 60 * 1000))) {
      return { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' };
    }

    const outcome = await work(ids);
    if (!outcome.ok) {
      return { success: false, error: outcome.error ?? 'Check the highlighted fields.', fieldErrors: outcome.fieldErrors };
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action,
      entityType: 'ShopWallet',
      entityId: ctx.organization.id,
    });
    revalidatePath('/settings/payments/wallet');
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return { success: false, error: 'You don’t have permission to change the shop wallet' };
    }
    console.error('[settings] Shop wallet PIN failed:', error instanceof Error ? error.message : 'unknown error');
    return { success: false, error: 'We couldn’t save the PIN. Please try again.' };
  }
}

export async function createShopPin(input: { pin: string; confirmPin: string }): Promise<ShopPinResult> {
  return run('settings.shop_wallet.pin_created', (ids) => createWalletPin(ids, input));
}

export async function changeShopPin(input: { currentPin: string; pin: string; confirmPin: string }): Promise<ShopPinResult> {
  return run('settings.shop_wallet.pin_changed', (ids) => changeWalletPin(ids, input));
}

/* ---------------- adding money ---------------- */

export type ShopTopUpStart =
  | { success: true; topUpId: string; accessCode: string; amount: number; fee: number; total: number }
  | { success: false; error: string; field?: 'amount' };

/** Step one: EduPay names its charges and gives Paystack's access code. Nothing is charged yet. */
export async function startShopTopUp(rawAmount: string): Promise<ShopTopUpStart> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    if (await isBusinessAppRequest()) return { success: false, error: NOT_IN_THE_APP };

    const amount = parseTopUpAmount(rawAmount);
    if (amount === null) {
      return { success: false, field: 'amount', error: `Enter a whole amount between ${formatMoney(MIN_TOP_UP)} and ${formatMoney(MAX_TOP_UP)}.` };
    }
    if (!(await checkRateLimit(`wallet-topup:shop:${ctx.organization.id}`, 20, 60 * 60 * 1000))) {
      return { success: false, error: 'Too many top-ups started. Please wait a while and try again.' };
    }

    const started = await startTopUp({ kind: 'SHOP', organizationId: ctx.organization.id, startedById: ctx.userId }, amount);
    if (!started.ok) {
      return {
        success: false,
        error:
          started.reason === 'no-wallet'
            ? 'Your shop wallet isn’t ready yet.'
            : started.reason === 'unavailable'
              ? 'We couldn’t reach EduPay just now. Please try again in a minute.'
              : 'EduPay couldn’t start this top-up. Please try a different amount.',
      };
    }
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.shop_wallet.top_up_started',
      entityType: 'WalletTopUp',
      entityId: started.topUpId,
      metadata: { amount: started.amount, total: started.total },
    });
    const { ok: _ok, ...rest } = started;
    return { success: true, ...rest };
  } catch (error) {
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return { success: false, error: 'You don’t have permission to add money to the shop wallet' };
    }
    console.error('[settings] Shop wallet top-up failed to start:', error instanceof Error ? error.message : 'unknown error');
    return { success: false, error: 'We couldn’t start the top-up. Please try again.' };
  }
}

/** Has it landed? `paid` is what Paystack's window said — a hint only. */
export async function checkShopTopUp(topUpId: string, paid: boolean): Promise<{ status: TopUpStatus | 'gone'; amount?: number }> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);
    const result = await checkTopUp({ kind: 'SHOP', organizationId: ctx.organization.id, startedById: ctx.userId }, topUpId, { reportedPaid: paid });
    if (!result) return { status: 'gone' };
    if (result.status === 'COMPLETED') revalidatePath('/settings/payments/wallet');
    return result;
  } catch {
    return { status: 'gone' };
  }
}
