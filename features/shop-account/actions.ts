'use server';

/*
 * features/shop-account/actions.ts
 *
 * Everything a shopper can do with their own account from a form: sign in,
 * register, ask for a reset link, set a new password, sign out.
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
import { checkRateLimit } from '@/lib/rate-limit';
import { sendStorefrontPasswordResetEmail } from '@/lib/email';
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

export type AccountFormState = {
  error?: string;
  fieldErrors?: Partial<Record<'name' | 'email' | 'password' | 'confirmPassword' | 'token', string>>;
  values?: { name?: string; email?: string };
  message?: string;
} | null;

const GENERIC_CREDENTIALS_ERROR = 'That email or password isn’t right. Please try again.';
const RESET_SENT_MESSAGE =
  'If there’s an account for that email address, a link to choose a new password is on its way.';

const PASSWORD = z.string().min(8, 'Use at least 8 characters');

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
  const byIp = checkRateLimit(`sf-auth:ip:${store.id}:${ip}`, 20, 15 * 60 * 1000);
  const byEmail = checkRateLimit(`sf-auth:email:${store.id}:${email.toLowerCase()}`, 8, 15 * 60 * 1000);
  return byIp && byEmail;
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

  const token = await issueSessionToken(store.slug, customer);
  await setSessionCookie(store.slug, token);

  redirect(next);
}

/* ---------------- register ---------------- */

const RegisterSchema = z.object({
  name: z.string().trim().min(2, 'Tell us what to call you'),
  email: z.email('Enter a valid email address'),
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
  const values = { name: rawName, email: rawEmail };

  const parsed = RegisterSchema.safeParse({
    name: rawName,
    email: rawEmail,
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const fieldErrors: NonNullable<AccountFormState>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'name' | 'email' | 'password';
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
    password: parsed.data.password,
  });

  if (!result.ok) {
    return {
      fieldErrors: { email: 'There’s already an account with this email. Sign in instead.' },
      values,
    };
  }

  const token = await issueSessionToken(store.slug, result.customer);
  await setSessionCookie(store.slug, token);

  redirect(next);
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
    checkRateLimit(`sf-reset:ip:${store.id}:${ip}`, 10, 15 * 60 * 1000) &&
    checkRateLimit(`sf-reset:email:${store.id}:${parsed.data.toLowerCase()}`, 5, 15 * 60 * 1000);

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

  redirect('/account');
}

/* ---------------- sign out ---------------- */

export async function signOutAction(): Promise<void> {
  const slug = await currentStoreSlug();
  if (slug) await clearSessionCookie(slug);
  redirect('/');
}
