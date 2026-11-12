/*
 * lib/wallet/register.ts
 *
 * One attempt to get a wallet from EduPay, and what it means — shared by
 * shopper wallets (./shopper.ts) and shop wallets (./shop.ts), so both
 * follow the same rules. Server only.
 *
 *   - created               → the new wallet.
 *   - exists, on the email  → connected, but only where connecting is
 *     allowed AND the email EduPay holds is the one we proved. EduPay keeps
 *     ONE wallet per person (2026-10-30): whichever type it was first made
 *     as, the same person reaches it as a shopper and as a vendor.
 *   - email taken           → EduPay's answer when the existing wallet is
 *     the other type, without its ids: asked once more as that type, which
 *     answers "exists" with them.
 *   - exists, on the phone  → never connected: we don't verify phones.
 *   - username taken        → a fresh suffix, up to three times.
 *   - our reference taken   → the wallet an unanswered earlier attempt made,
 *     when EduPay sends its ids.
 *   - unreachable           → try again later.
 *   - anything else         → stop, with the reason for staff.
 */
import { randomBytes } from 'crypto';
import { normalizeEmail } from '@/lib/storefront/account/shopper';
import { registerUser } from './edupay';

const USERNAME_TRIES = 3;
export const MAX_ATTEMPTS = 10;
/** A claim older than this was a request that died; someone else may take over. */
export const STALE_CLAIM_MS = 2 * 60_000;

/** Five minutes, doubling, at most six hours. */
export function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60_000);
}

/**
 * EduPay usernames: the name without spaces or accents, plus a random suffix
 * (EduPay's rule) — "Adaeze Okafor-Bello" → "adaezeokaforbel7k2m9q".
 */
export function generateUsername(fullName: string, fallback = 'shopper'): string {
  const base =
    fullName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 16) || fallback;
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const suffix = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  return `${base}${suffix}`;
}

export type Decision =
  | { kind: 'active'; origin: 'CREATED' | 'CONNECTED'; uuid: string; uniqId: string }
  | { kind: 'phone-in-use' }
  | { kind: 'retry'; error: string }
  | { kind: 'failed'; error: string };

export async function decideRegistration(input: {
  userType: 'normal' | 'business';
  userRef: string;
  fullName: string;
  email: string;
  /** 0803… */
  phone: string;
  /**
   * Whether this email may be connected to the wallet EduPay already has for
   * it: a shopper's proved email; a shop's contact email only when an Owner
   * proved it to us (./shop.ts).
   */
  mayConnect: boolean;
  usernameFallback?: string;
}): Promise<Decision> {
  let userType = input.userType;
  let askedOtherType = false;
  for (let i = 0; i < USERNAME_TRIES; i++) {
    const result = await registerUser({
      userType,
      userRef: input.userRef,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      username: generateUsername(input.fullName, input.usernameFallback),
    });

    switch (result.kind) {
      case 'created':
        return { kind: 'active', origin: 'CREATED', uuid: result.uuid, uniqId: result.uniqId };

      case 'exists': {
        if (!input.mayConnect) {
          return { kind: 'failed', error: `EduPay already has a wallet for this ${result.matchedOn ?? 'contact'}, and it isn't an email we may connect` };
        }
        const sameEmail = result.email !== null && normalizeEmail(result.email) === normalizeEmail(input.email);
        if (result.matchedOn === 'email' && sameEmail && result.uuid && result.uniqId) {
          return { kind: 'active', origin: 'CONNECTED', uuid: result.uuid, uniqId: result.uniqId };
        }
        if (result.matchedOn === 'phone') return { kind: 'phone-in-use' };
        return { kind: 'failed', error: `EduPay matched an existing user on ${result.matchedOn ?? 'nothing named'} that isn't this email` };
      }

      case 'username-taken':
        continue;

      case 'user-ref-taken':
        // Our reference is ours alone, so this is the wallet an earlier,
        // unanswered attempt created.
        if (result.uuid && result.uniqId) return { kind: 'active', origin: 'CREATED', uuid: result.uuid, uniqId: result.uniqId };
        return { kind: 'failed', error: 'EduPay already has this reference but sent no wallet ids' };

      case 'rejected':
        if (result.code === 'EMAIL_TAKEN' && !askedOtherType) {
          askedOtherType = true;
          userType = userType === 'business' ? 'normal' : 'business';
          i -= 1; // not a username retry
          continue;
        }
        return { kind: 'failed', error: `EduPay refused: ${[result.code, result.message].filter(Boolean).join(' — ') || 'no reason given'}` };

      case 'unavailable':
        return { kind: 'retry', error: `EduPay unreachable (${result.reason})` };
    }
  }
  return { kind: 'failed', error: 'Every generated username was taken' };
}
