'use server';

/*
 * features/shop-account/actions.ts
 *
 * Everything a shopper can do with their own account from a form: sign in,
 * register, confirm their email with a code, ask for a reset link, set a new
 * password, sign out.
 *
 * NO SESSION WITHOUT A PROVED ADDRESS (ROADMAP 20.1). Registering, or signing
 * in to an account whose address was never proved, emails a six-digit code
 * and goes to /account/verify instead of signing in. The session is issued
 * only once the code is typed back (`verifyEmailAction`).
 *
 * WHICH STORE. These run on the store's own origin, so proxy.ts has already
 * stamped `x-org-slug` on the request — the same header the catalogue reads
 * (lib/storefront/data/current.ts). No action here takes the store from the
 * form: a hidden field naming the organization would be a hidden field an
 * attacker could change.
 *
 * WHAT THE SHOPPER IS TOLD. "That email or password isn't right" covers a
 * wrong password, an unknown address, and an address that exists but has no
 * password on it. Which of the three it is belongs to the account holder,
 * not to whoever is typing. The reset form says the same sentence whether or
 * not an account exists, for the same reason.
 *
 * WHAT IS KEPT. Every failure returns the fields the shopper typed (except
 * passwords) so the form comes back filled in. Nobody should have to retype
 * their address because they fat-fingered a password.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NIGERIAN_PHONE_ERROR, normalizeNigerianPhone } from '@/lib/phone';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendStorefrontPasswordResetEmail, sendStorefrontVerificationCodeEmail } from '@/lib/email';
import {
  RESET_TOKEN_TTL_MINUTES,
  createPasswordResetToken,
  findStoreBySlug,
  issueSessionToken,
  registerShopper,
  resetPasswordWithToken,
  verifyShopperCredentials,
  type StoreRecord,
} from '@/lib/storefront/account/shopper';
import { clearSessionCookie, setSessionCookie, currentStoreSlug } from '@/lib/storefront/account/session';
import { safeNextPath, storeUrl } from '@/lib/storefront/account/return-url';
import { adoptGuestChatOnSignIn } from '@/lib/chat/storefront';
import { requestShopperWallet } from '@/lib/wallet/shopper';
import {
  CODE_TTL_MINUTES,
  clearVerifyCookie,
  confirmVerificationCode,
  findPendingVerification,
  issueVerificationCode,
  readVerifyCookie,
  setVerifyCookie,
} from '@/lib/storefront/account/email-verification';

export type AccountFormState = {
  error?: string;
  fieldErrors?: Partial<Record<'name' | 'email' | 'phone' | 'password' | 'confirmPassword' | 'token' | 'code', string>>;
  values?: { name?: string; email?: string; phone?: string };
  message?: string;
} | null;

const GENERIC_CREDENTIALS_ERROR = 'That email or password isn’t right. Please try again.';
const RESET_SENT_MESSAGE =
  'If there’s an account for that email address, a link to choose a new password is on its way.';

const PASSWORD = z.string().min(8, 'Use at least 8 characters');

/** Required: the wallet every account gets needs one (ROADMAP 20.2). Stored as +234…. */
const PHONE = z
  .string()
  .trim()
  .min(1, 'Enter your phone number')
  .transform((value, ctx) => {
    const phone = normalizeNigerianPhone(value);
    if (!phone) ctx.addIssue({ code: 'custom', message: NIGERIAN_PHONE_ERROR });
    return phone ?? '';
  });

async function requireStore(): Promise<StoreRecord> {
  const slug = await currentStoreSlug();
  const store = slug ? await findStoreBySlug(slug) : null;
  // Only reachable if an action is somehow invoked outside a storefront
  // request; there is no sensible shopper-facing wording for it.
  if (!store) throw new Error('Storefront account action called outside a store request');
  return store;
}

async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headerList.get('x-real-ip') ?? 'unknown';
}

/** Generous by design: a false positive here locks out a real shopper. */
async function withinSignInLimit(store: StoreRecord, email: string): Promise<boolean> {
  const ip = await clientIp();
  const byIp = await checkRateLimit(`sf-auth:ip:${store.id}:${ip}`, 20, 15 * 60 * 1000);
  const byEmail = await checkRateLimit(`sf-auth:email:${store.id}:${email.toLowerCase()}`, 8, 15 * 60 * 1000);
  return byIp && byEmail;
}

/**
 * Email a code for this account and send the browser to type it in. Never
 * returns. If the email didn't go, "Send a new code" on that page retries.
 */
async function beginVerification(
  store: StoreRecord,
  customer: { id: string; email: string | null },
  next: string,
): Promise<never> {
  const issued = await issueVerificationCode(customer.id, { cooldown: false });
  if (issued && customer.email) {
    await setVerifyCookie(store.slug, issued.rawToken);
    await sendStorefrontVerificationCodeEmail({
      to: customer.email,
      storeName: store.name,
      code: issued.code,
      expiresInMinutes: CODE_TTL_MINUTES,
    });
  }
  redirect(`/account/verify?next=${encodeURIComponent(next)}`);
}

/* ---------------- sign in ---------------- */

const SignInSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export async function signInAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const store = await requireStore();
  const next = safeNextPath(formData.get('next') as string | null);
  const rawEmail = String(formData.get('email') ?? '');

  const parsed = SignInSchema.safeParse({
    email: rawEmail,
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const fieldErrors: NonNullable<AccountFormState>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'email' | 'password';
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors, values: { email: rawEmail } };
  }

  if (!(await withinSignInLimit(store, parsed.data.email))) {
    return {
      error: 'Too many attempts. Please wait a few minutes and try again.',
      values: { email: rawEmail },
    };
  }

  const customer = await verifyShopperCredentials({
    organizationId: store.id,
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!customer) {
    return { error: GENERIC_CREDENTIALS_ERROR, values: { email: rawEmail } };
  }

  // The right password on an address nobody has proved yet: prove it first.
  if (!customer.emailVerifiedAt) return beginVerification(store, customer, next);

  const token = await issueSessionToken(store.slug, customer);
  await setSessionCookie(store.slug, token);
  // A guest who messaged the store first keeps that conversation (ROADMAP 17.3).
  await adoptGuestChatOnSignIn(store, customer.id);

  redirect(next);
}

/* ---------------- register ---------------- */

const RegisterSchema = z.object({
  name: z.string().trim().min(2, 'Tell us what to call you'),
  email: z.email('Enter a valid email address'),
  phone: PHONE,
  password: PASSWORD,
});

export async function registerAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const store = await requireStore();
  const next = safeNextPath(formData.get('next') as string | null);
  const rawName = String(formData.get('name') ?? '');
  const rawEmail = String(formData.get('email') ?? '');
  const rawPhone = String(formData.get('phone') ?? '');
  const values = { name: rawName, email: rawEmail, phone: rawPhone };

  const parsed = RegisterSchema.safeParse({
    name: rawName,
    email: rawEmail,
    phone: rawPhone,
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const fieldErrors: NonNullable<AccountFormState>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'name' | 'email' | 'phone' | 'password';
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  if (!(await withinSignInLimit(store, parsed.data.email))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.', values };
  }

  const result = await registerShopper({
    organizationId: store.id,
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    password: parsed.data.password,
  });

  if (!result.ok) {
    return {
      fieldErrors: {
        email: 'There’s already an account with this email. Sign in, or use “Forgot password” if you can’t.',
      },
      values,
    };
  }

  return beginVerification(store, result.customer, next);
}

/* ---------------- confirm the email ---------------- */

const CODE_ERRORS = {
  'wrong-code': 'That code isn’t right. Check the email and try again.',
  expired: 'That code has expired. Send yourself a new one below.',
  locked: 'Too many tries. Send yourself a new code below.',
  'no-challenge': 'We couldn’t find a code for this device. Please sign in again.',
} as const;

export async function verifyEmailAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const store = await requireStore();
  const next = safeNextPath(formData.get('next') as string | null);
  const rawToken = await readVerifyCookie(store.slug);
  if (!rawToken) return { error: CODE_ERRORS['no-challenge'] };

  const ip = await clientIp();
  if (!(await checkRateLimit(`sf-verify:ip:${store.id}:${ip}`, 30, 15 * 60 * 1000))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }

  const result = await confirmVerificationCode(store.id, rawToken, String(formData.get('code') ?? ''));
  if (!result.ok) {
    return result.reason === 'wrong-code'
      ? { fieldErrors: { code: CODE_ERRORS['wrong-code'] } }
      : { error: CODE_ERRORS[result.reason] };
  }

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: result.customerId },
    select: { id: true, organizationId: true, sessionVersion: true },
  });
  await setSessionCookie(store.slug, await issueSessionToken(store.slug, customer));
  await clearVerifyCookie(store.slug);
  await adoptGuestChatOnSignIn(store, customer.id);
  // The proved email is what the wallet hangs on (ROADMAP 20.2).
  await requestShopperWallet(customer.id);

  redirect(next);
}

export async function resendVerificationCodeAction(
  _prev: AccountFormState,
  _formData: FormData,
): Promise<AccountFormState> {
  const store = await requireStore();
  const rawToken = await readVerifyCookie(store.slug);
  const pending = rawToken ? await findPendingVerification(store.id, rawToken) : null;
  if (!pending) return { error: CODE_ERRORS['no-challenge'] };

  const allowed = await checkRateLimit(`sf-verify-send:${pending.customerId}`, 5, 60 * 60 * 1000);
  const issued = allowed ? await issueVerificationCode(pending.customerId) : null;
  if (!issued) return { error: 'A code was sent a moment ago. Please wait a minute before asking for another.' };

  await setVerifyCookie(store.slug, issued.rawToken);
  const sent = await sendStorefrontVerificationCodeEmail({
    to: pending.email,
    storeName: store.name,
    code: issued.code,
    expiresInMinutes: CODE_TTL_MINUTES,
  });
  return sent
    ? { message: `A new code is on its way to ${pending.email}.` }
    : { error: 'We couldn’t send the email just now. Please try again in a minute.' };
}

/* ---------------- forgot password ---------------- */

export async function forgotPasswordAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const store = await requireStore();
  const rawEmail = String(formData.get('email') ?? '');

  const parsed = z.email().safeParse(rawEmail.trim());
  // A malformed address gets the same answer as a valid one: this form
  // reveals nothing about who shops here.
  if (!parsed.success) return { message: RESET_SENT_MESSAGE };

  const ip = await clientIp();
  const allowed =
    await checkRateLimit(`sf-reset:ip:${store.id}:${ip}`, 10, 15 * 60 * 1000) &&
    await checkRateLimit(`sf-reset:email:${store.id}:${parsed.data.toLowerCase()}`, 5, 15 * 60 * 1000);

  if (!allowed) return { message: RESET_SENT_MESSAGE };

  const issued = await createPasswordResetToken({ organizationId: store.id, email: parsed.data });

  if (issued?.customer.email) {
    await sendStorefrontPasswordResetEmail({
      to: issued.customer.email,
      storeName: store.name,
      resetUrl: storeUrl(store, `/account/reset-password?token=${issued.rawToken}`),
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    });
  }

  return { message: RESET_SENT_MESSAGE };
}

/* ---------------- reset password ---------------- */

const ResetSchema = z
  .object({
    token: z.string().min(1),
    password: PASSWORD,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Both passwords need to match',
    path: ['confirmPassword'],
  });

export async function resetPasswordAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const store = await requireStore();

  const parsed = ResetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    const fieldErrors: NonNullable<AccountFormState>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'password' | 'confirmPassword' | 'token';
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors };
  }

  const result = await resetPasswordWithToken({
    organizationId: store.id,
    rawToken: parsed.data.token,
    newPassword: parsed.data.password,
  });

  if (!result.ok) {
    return {
      error:
        'That link has expired or has already been used. Ask for a new one and it’ll work.',
    };
  }

  // Straight in — making someone who just proved they own the inbox type
  // the password they set four seconds ago helps nobody.
  const token = await issueSessionToken(store.slug, result.customer);
  await setSessionCookie(store.slug, token);
  await adoptGuestChatOnSignIn(store, result.customer.id);

  redirect('/account');
}

/* ---------------- sign out ---------------- */

export async function signOutAction(): Promise<void> {
  const slug = await currentStoreSlug();
  if (slug) await clearSessionCookie(slug);
  redirect('/');
}
