'use server';

/*
 * features/shop-account/wallet-actions.ts
 *
 * A shopper's own wallet: creating or changing its PIN, and adding money
 * to it (ROADMAP 20.3). The wallet is always the signed-in shopper's own,
 * found from their session — never named by the form; a top-up id from the
 * page is only ever looked up together with whose it must be. PINs go to
 * EduPay and nowhere else, and are never sent back to the page.
 */
import { revalidatePath } from 'next/cache';
import { checkRateLimit } from '@/lib/rate-limit';
import { getShopper } from '@/lib/storefront/account/session';
import { activeShopperWalletIds } from '@/lib/wallet/shopper';
import { changeWalletPin, createWalletPin, type PinFieldErrors, type PinOutcome } from '@/lib/wallet/pin';
import { MAX_TOP_UP, MIN_TOP_UP, checkTopUp, parseTopUpAmount, startTopUp, type TopUpStatus } from '@/lib/wallet/top-up';
import { formatMoney } from '@/lib/storefront/format';

export type WalletPinFormState = { error?: string; fieldErrors?: PinFieldErrors; message?: string } | null;

const field = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

async function run(work: (ids: { uuid: string; uniqId: string }) => Promise<PinOutcome>, done: string): Promise<WalletPinFormState> {
  const shopper = await getShopper();
  if (!shopper) return { error: 'Your session has ended. Please sign in again.' };
  const ids = await activeShopperWalletIds(shopper.id);
  if (!ids) return { error: 'Your wallet isn’t ready yet. Please try again in a minute.' };
  if (!(await checkRateLimit(`wallet-pin:shopper:${shopper.id}`, 10, 15 * 60 * 1000))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }

  const outcome = await work(ids);
  if (!outcome.ok) return { error: outcome.error, fieldErrors: outcome.fieldErrors };
  revalidatePath('/account/wallet');
  return { message: done };
}

export async function createShopperPinAction(_prev: WalletPinFormState, formData: FormData): Promise<WalletPinFormState> {
  return run(
    (ids) => createWalletPin(ids, { pin: field(formData, 'pin'), confirmPin: field(formData, 'confirmPin') }),
    'Your wallet PIN is set.',
  );
}

export async function changeShopperPinAction(_prev: WalletPinFormState, formData: FormData): Promise<WalletPinFormState> {
  return run(
    (ids) =>
      changeWalletPin(ids, {
        currentPin: field(formData, 'currentPin'),
        pin: field(formData, 'pin'),
        confirmPin: field(formData, 'confirmPin'),
      }),
    'Your wallet PIN has been changed.',
  );
}

/* ---------------- adding money ---------------- */

export type StartTopUpResult =
  | { ok: true; topUpId: string; accessCode: string; amount: number; fee: number; total: number }
  | { ok: false; error: string; field?: 'amount' };

/** Step one: EduPay names its charges and gives Paystack's access code. Nothing is charged yet. */
export async function startShopperTopUpAction(rawAmount: string): Promise<StartTopUpResult> {
  const shopper = await getShopper();
  if (!shopper) return { ok: false, error: 'Your session has ended. Please sign in again.' };
  const amount = parseTopUpAmount(rawAmount);
  if (amount === null) {
    return {
      ok: false,
      field: 'amount',
      error: `Enter a whole amount between ${formatMoney(MIN_TOP_UP * 100)} and ${formatMoney(MAX_TOP_UP * 100)}.`,
    };
  }
  if (!(await checkRateLimit(`wallet-topup:shopper:${shopper.id}`, 10, 60 * 60 * 1000))) {
    return { ok: false, error: 'Too many top-ups started. Please wait a while and try again.' };
  }

  const started = await startTopUp({ kind: 'SHOPPER', organizationId: shopper.organizationId, customerId: shopper.id }, amount);
  if (started.ok) return started;
  return {
    ok: false,
    error:
      started.reason === 'no-wallet'
        ? 'Your wallet isn’t ready yet. Please try again in a minute.'
        : started.reason === 'unavailable'
          ? 'We couldn’t reach EduPay just now. Please try again in a minute.'
          : 'EduPay couldn’t start this top-up. Please try a different amount.',
  };
}

/**
 * Has it landed? Asked after Paystack's window closes; `paid` is what that
 * window said, kept only as a hint (see lib/wallet/top-up.ts).
 */
export async function checkShopperTopUpAction(topUpId: string, paid: boolean): Promise<{ status: TopUpStatus | 'gone'; amount?: number }> {
  const shopper = await getShopper();
  if (!shopper) return { status: 'gone' };
  const result = await checkTopUp(
    { kind: 'SHOPPER', organizationId: shopper.organizationId, customerId: shopper.id },
    topUpId,
    { reportedPaid: paid },
  );
  if (!result) return { status: 'gone' };
  if (result.status === 'COMPLETED') revalidatePath('/account/wallet');
  return result;
}
