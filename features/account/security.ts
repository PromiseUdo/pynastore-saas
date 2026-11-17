'use server';

/*
 * features/account/security.ts
 *
 * The signed-in person's own sign-in (ROADMAP 14.5): their name, email and
 * password, two-step sign-in, and signing out other devices. Always their
 * own account, from the session — never named by the page — so no shop
 * permission is needed. Every change that matters to their safety is emailed
 * to them (lib/email.ts sendAccountSecurityEmail); codes and passwords are
 * never logged or sent back.
 */
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendAccountSecurityEmail } from '@/lib/email';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { PLATFORM_NAME } from '@/lib/brand';
import { changePassword, confirmEmailChange, requestEmailChange, updateName } from '@/lib/account-security/account';
import { confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes, startTwoFactorSetup, type SetupStart } from '@/lib/account-security/two-factor';
import { signOutOtherSessions } from '@/lib/account-security/sessions';
import { prisma } from '@/lib/prisma';

export type SecurityResult<T = undefined> = { success: true; data: T } | { success: false; error: string; field?: string };

const PAGE = '/settings/account';
const SIGNED_OUT: SecurityResult<never> = { success: false, error: 'Sign in again to continue.' };
const TOO_MANY: SecurityResult<never> = { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' };
const NOT_YOU = `If this wasn’t you, someone else may be in your account: reset your password now and turn on two-step sign-in.`;

async function me() {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function emailOf(userId: string): Promise<string | null> {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null;
}

const resetUrl = () => getMarketingUrl('/forgot-password');

/* ---------------- profile ---------------- */

export async function updateNameAction(name: string): Promise<SecurityResult> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  const result = await updateName(userId, String(name ?? ''));
  if (!result.ok) return { success: false, error: result.error, field: 'name' };
  revalidatePath(PAGE);
  return { success: true, data: undefined };
}

export async function requestEmailChangeAction(input: { newEmail: string; password: string }): Promise<SecurityResult<{ newEmail: string }>> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  if (!(await checkRateLimit(`email-change:${userId}`, 5, 60 * 60 * 1000))) return TOO_MANY;
  const result = await requestEmailChange(userId, { newEmail: String(input?.newEmail ?? ''), password: String(input?.password ?? '') });
  if (!result.ok) return { success: false, error: result.error, field: result.field };

  if (result.deliver) {
    await sendAccountSecurityEmail({
      to: result.newEmail,
      subject: `Confirm your new email for ${PLATFORM_NAME}`,
      heading: 'Confirm your new email',
      paragraphs: [`Open this link to move your ${PLATFORM_NAME} account to this address. It works for 24 hours.`],
      action: { label: 'Confirm this email', url: getMarketingUrl(`/confirm-email/${result.token}`) },
      notYou: 'If you didn’t ask for this, ignore this email — nothing will change.',
    });
  }
  await sendAccountSecurityEmail({
    to: result.oldEmail,
    subject: `Your ${PLATFORM_NAME} email is being changed`,
    heading: 'Your email is being changed',
    paragraphs: [`Someone asked to move your account to ${result.newEmail}. It won’t change until that address is confirmed.`],
    action: { label: 'Reset my password', url: resetUrl() },
    notYou: `If this wasn’t you, reset your password now: that signs everyone else out and stops the change.`,
  });
  return { success: true, data: { newEmail: result.newEmail } };
}

/** From the link in the new address's inbox — the one action here that needs no session. */
export async function confirmEmailChangeAction(token: string): Promise<SecurityResult<{ email: string }>> {
  const result = await confirmEmailChange(String(token ?? ''));
  return result.ok ? { success: true, data: { email: result.email } } : { success: false, error: result.error };
}

/* ---------------- password ---------------- */

export async function changePasswordAction(input: { current: string; next: string }): Promise<SecurityResult> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  if (!(await checkRateLimit(`password-change:${userId}`, 10, 15 * 60 * 1000))) return TOO_MANY;
  const result = await changePassword(userId, { current: String(input?.current ?? ''), next: String(input?.next ?? '') });
  if (!result.ok) return { success: false, error: result.error, field: result.field };

  // Anyone who had the old password is out; this device stays in.
  await signOutOtherSessions(userId);
  await sendAccountSecurityEmail({
    to: result.email,
    subject: `Your ${PLATFORM_NAME} password was changed`,
    heading: 'Your password was changed',
    paragraphs: ['Your password was just changed, and every other device was signed out.'],
    action: { label: 'Reset my password', url: resetUrl() },
    notYou: NOT_YOU,
  });
  // No revalidatePath: see confirmTwoFactorAction — the page refreshes itself.
  return { success: true, data: undefined };
}

/* ---------------- two-step sign-in ---------------- */

export async function startTwoFactorAction(): Promise<SecurityResult<SetupStart>> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  const started = await startTwoFactorSetup(userId);
  if (started === null) return { success: false, error: 'Two-step sign-in is for signing in with a password. Google and Apple have their own.' };
  if (started === 'already-on') return { success: false, error: 'Two-step sign-in is already on.' };
  return { success: true, data: started };
}

export async function confirmTwoFactorAction(code: string): Promise<SecurityResult<{ recoveryCodes: string[] }>> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  if (!(await checkRateLimit(`two-factor-setup:${userId}`, 10, 15 * 60 * 1000))) return TOO_MANY;
  const result = await confirmTwoFactorSetup(userId, String(code ?? ''));
  if (!result.ok) {
    return result.reason === 'wrong-code'
      ? { success: false, error: 'That code isn’t right. Try the newest one in your app.', field: 'code' }
      : { success: false, error: 'Start setting it up again.' };
  }
  // Sessions that only knew the password are signed out; this one just proved a code.
  await signOutOtherSessions(userId, { provedSecondFactor: true });
  const email = await emailOf(userId);
  if (email) {
    await sendAccountSecurityEmail({
      to: email,
      subject: `Two-step sign-in is on for your ${PLATFORM_NAME} account`,
      heading: 'Two-step sign-in is on',
      paragraphs: ['From now on, signing in with your password also needs a code from your authenticator app. Every other device was signed out.'],
      notYou: NOT_YOU,
    });
  }
  /* No revalidatePath here: it would re-render this page inside the same
   * request, which still carries the session cookie from before
   * signOutOtherSessions — read as signed out, sending the person to sign
   * in. The page refreshes itself once the browser holds the renewed one. */
  return { success: true, data: { recoveryCodes: result.recoveryCodes } };
}

export async function disableTwoFactorAction(code: string): Promise<SecurityResult> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  if (!(await checkRateLimit(`two-factor-off:${userId}`, 10, 15 * 60 * 1000))) return TOO_MANY;
  if (!(await disableTwoFactor(userId, String(code ?? '')))) return { success: false, error: 'That code isn’t right.', field: 'code' };
  const email = await emailOf(userId);
  if (email) {
    await sendAccountSecurityEmail({
      to: email,
      subject: `Two-step sign-in was turned off for your ${PLATFORM_NAME} account`,
      heading: 'Two-step sign-in was turned off',
      paragraphs: ['Signing in with your password no longer asks for a code.'],
      action: { label: 'Reset my password', url: resetUrl() },
      notYou: NOT_YOU,
    });
  }
  revalidatePath(PAGE);
  return { success: true, data: undefined };
}

export async function regenerateRecoveryCodesAction(code: string): Promise<SecurityResult<{ recoveryCodes: string[] }>> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  if (!(await checkRateLimit(`two-factor-codes:${userId}`, 10, 15 * 60 * 1000))) return TOO_MANY;
  const codes = await regenerateRecoveryCodes(userId, String(code ?? ''));
  if (!codes) return { success: false, error: 'That code isn’t right.', field: 'code' };
  revalidatePath(PAGE);
  return { success: true, data: { recoveryCodes: codes } };
}

/* ---------------- devices ---------------- */

export async function signOutOtherDevicesAction(): Promise<SecurityResult> {
  const userId = await me();
  if (!userId) return SIGNED_OUT;
  await signOutOtherSessions(userId);
  return { success: true, data: undefined };
}
