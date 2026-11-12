/*
 * lib/account-security/strong-sign-in.ts
 *
 * Which sign-ins count as two steps (ROADMAP 14.5): a password and a code
 * ('two-factor'), or Google or Apple, which have their own — the business
 * app's 'app-handoff' is one of those finished in its browser sheet. Money
 * leaves a shop only from such a session. Pure.
 */
export const STRONG_SIGN_INS = ['two-factor', 'google', 'apple', 'app-handoff'] as const;

export function isStrongSignIn(method: string | null | undefined): boolean {
  return (STRONG_SIGN_INS as readonly string[]).includes(method ?? '');
}
