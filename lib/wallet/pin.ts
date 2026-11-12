/*
 * lib/wallet/pin.ts
 *
 * Creating and changing a wallet's PIN, for shopper and shop wallets alike
 * (ROADMAP 20.3). Server only. Callers (features/shop-account/wallet-actions.ts,
 * features/settings/shop-wallet.ts) decide WHOSE wallet; this decides
 * whether the PINs typed make sense and says what EduPay answered, in words
 * a person can act on.
 */
import { changePin, setUpPin, type PinResult, type WalletIds } from './edupay';

/** Four digits — EduPay's PIN. */
export function isPinShape(value: string): boolean {
  return /^\d{4}$/.test(value);
}

export type PinFieldErrors = Partial<Record<'currentPin' | 'pin' | 'confirmPin', string>>;

export type PinOutcome = { ok: true } | { ok: false; error?: string; fieldErrors?: PinFieldErrors };

const REFUSALS: Record<Exclude<PinResult, { ok: true }>['reason'], PinOutcome> = {
  'wrong-pin': { ok: false, fieldErrors: { currentPin: 'That isn’t your current PIN.' } },
  locked: { ok: false, error: 'Your PIN is locked after too many wrong tries. Please try again later.' },
  'already-set': { ok: false, error: 'This wallet already has a PIN. Change it instead.' },
  'not-set': { ok: false, error: 'This wallet has no PIN yet. Create one first.' },
  'weak-pin': { ok: false, fieldErrors: { pin: 'That PIN is too easy to guess. Avoid repeated or sequential digits.' } },
  rejected: { ok: false, error: 'EduPay didn’t accept that PIN. Please try a different one.' },
  unavailable: { ok: false, error: 'We couldn’t reach EduPay just now. Please try again in a minute.' },
};

function checkNew(pin: string, confirmPin: string): PinFieldErrors | null {
  if (!isPinShape(pin)) return { pin: 'Use exactly 4 digits.' };
  if (pin !== confirmPin) return { confirmPin: 'The two PINs don’t match.' };
  return null;
}

export async function createWalletPin(ids: WalletIds, input: { pin: string; confirmPin: string }): Promise<PinOutcome> {
  const fieldErrors = checkNew(input.pin, input.confirmPin);
  if (fieldErrors) return { ok: false, fieldErrors };
  const result = await setUpPin(ids, input.pin);
  return result.ok ? { ok: true } : REFUSALS[result.reason];
}

export async function changeWalletPin(
  ids: WalletIds,
  input: { currentPin: string; pin: string; confirmPin: string },
): Promise<PinOutcome> {
  if (!isPinShape(input.currentPin)) return { ok: false, fieldErrors: { currentPin: 'Enter your current 4-digit PIN.' } };
  const fieldErrors = checkNew(input.pin, input.confirmPin);
  if (fieldErrors) return { ok: false, fieldErrors };
  if (input.pin === input.currentPin) return { ok: false, fieldErrors: { pin: 'Choose a PIN different from your current one.' } };
  const result = await changePin(ids, input.currentPin, input.pin);
  return result.ok ? { ok: true } : REFUSALS[result.reason];
}
