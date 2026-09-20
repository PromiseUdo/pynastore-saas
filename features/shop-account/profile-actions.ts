'use server';

/*
 * features/shop-account/profile-actions.ts
 *
 * What a signed-in shopper changes about their own account.
 *
 * Every action re-reads the session itself rather than trusting a customer
 * id from the form. A hidden field saying which account to edit is a hidden
 * field somebody can edit — so the only account any of these can touch is
 * the one the cookie proves.
 *
 * Password and email changes invalidate every session (see
 * lib/storefront/account/profile.ts). That includes the one being used right
 * now, so each of those actions re-issues the current cookie on success:
 * succeeding at "change my password" and being thrown out for it would read
 * as a failure.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { setPassword, updateProfile } from '@/lib/storefront/account/profile';
import {
  EMAIL_CHANGE_TTL_MINUTES,
  confirmEmailChange,
  requestEmailChange,
} from '@/lib/storefront/account/email-change';
import {
  sendStorefrontConfirmEmailChange,
  sendStorefrontEmailChangeNotice,
} from '@/lib/email';
import { storeUrl } from '@/lib/storefront/account/return-url';
import { findStoreBySlug, issueSessionToken } from '@/lib/storefront/account/shopper';
import { currentStoreSlug, getShopper, setSessionCookie } from '@/lib/storefront/account/session';

export type ProfileFormState = {
  error?: string;
  fieldErrors?: Partial<
    Record<'name' | 'phone' | 'email' | 'currentPassword' | 'newPassword' | 'confirmPassword', string>
  >;
  values?: { name?: string; phone?: string; email?: string };
  message?: string;
} | null;

const NOT_SIGNED_IN = 'Your session has ended. Please sign in again.';

async function context() {
  const slug = await currentStoreSlug();
  const store = slug ? await findStoreBySlug(slug) : null;
  const shopper = await getShopper();
  if (!store || !shopper) return null;
  return { store, shopper };
}

/** Re-issue the cookie after a change that bumped `sessionVersion`. */
async function keepSignedIn(
  slug: string,
  customer: { id: string; organizationId: string; sessionVersion: number },
) {
  await setSessionCookie(slug, await issueSessionToken(slug, customer));
}

/* ---------------- name and phone ---------------- */

const ProfileSchema = z.object({
  name: z.string().trim().min(2, 'Tell us what to call you'),
  phone: z
    .string()
    .trim()
    .max(32, 'That looks too long for a phone number')
    .optional()
    .or(z.literal('')),
});

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ctx = await context();
  if (!ctx) return { error: NOT_SIGNED_IN };

  const rawName = String(formData.get('name') ?? '');
  const rawPhone = String(formData.get('phone') ?? '');
  const values = { name: rawName, phone: rawPhone };

  const parsed = ProfileSchema.safeParse({ name: rawName, phone: rawPhone });
  if (!parsed.success) {
    const fieldErrors: NonNullable<ProfileFormState>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'name' | 'phone';
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  const updated = await updateProfile({
    organizationId: ctx.store.id,
    customerId: ctx.shopper.id,
    name: parsed.data.name,
    phone: parsed.data.phone || null,
  });

  if (!updated) return { error: NOT_SIGNED_IN };

  // The header greets by first name, so the whole shell has to catch up.
  revalidatePath('/', 'layout');

  return { message: 'Saved.' };
}

/* ---------------- password ---------------- */

const PasswordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'Use at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Both passwords need to match',
    path: ['confirmPassword'],
  });

export async function setPasswordAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ctx = await context();
  if (!ctx) return { error: NOT_SIGNED_IN };

  const parsed = PasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword') ?? undefined,
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    const fieldErrors: NonNullable<ProfileFormState>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'newPassword' | 'confirmPassword' | 'currentPassword';
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors };
  }

  const result = await setPassword({
    organizationId: ctx.store.id,
    customerId: ctx.shopper.id,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
  });

  if (!result.ok) {
    if (result.reason === 'wrong-password') {
      return { fieldErrors: { currentPassword: 'That isn’t your current password' } };
    }
    return { error: NOT_SIGNED_IN };
  }

  await keepSignedIn(ctx.store.slug, result.customer);
  revalidatePath('/account/profile');

  return {
    message: 'Password saved. Anywhere else you were signed in has been signed out.',
  };
}

/* ---------------- email ---------------- */

const EmailSchema = z.object({
  email: z.email('Enter a valid email address'),
  currentPassword: z.string().min(1, 'Enter your password to confirm'),
});

/**
 * Step one: ask to move the address.
 *
 * Nothing on the account changes here. A link goes to the new address, and a
 * warning goes to the old one — see lib/storefront/account/email-change.ts
 * for why both, and why in that order.
 */
export async function requestEmailChangeAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ctx = await context();
  if (!ctx) return { error: NOT_SIGNED_IN };

  const rawEmail = String(formData.get('email') ?? '');
  const values = { email: rawEmail };

  const parsed = EmailSchema.safeParse({
    email: rawEmail,
    currentPassword: formData.get('currentPassword'),
  });

  if (!parsed.success) {
    const fieldErrors: NonNullable<ProfileFormState>['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as 'email' | 'currentPassword';
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  const result = await requestEmailChange({
    organizationId: ctx.store.id,
    customerId: ctx.shopper.id,
    newEmail: parsed.data.email,
    currentPassword: parsed.data.currentPassword,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'wrong-password':
        return { fieldErrors: { currentPassword: 'That isn’t your password' }, values };
      case 'email-taken':
        return { fieldErrors: { email: 'There’s already an account here with that email' }, values };
      case 'same-email':
        return { fieldErrors: { email: 'That’s already your email' }, values };
      case 'no-password':
        return {
          error:
            'You sign in with Google, so your email comes from there. Add a password below first if you want to change it.',
          values,
        };
      default:
        return { error: NOT_SIGNED_IN };
    }
  }

  await sendStorefrontConfirmEmailChange({
    to: result.newEmail,
    storeName: ctx.store.name,
    confirmUrl: storeUrl(ctx.store, `/account/confirm-email?token=${result.rawToken}`),
    expiresInMinutes: EMAIL_CHANGE_TTL_MINUTES,
  });

  if (result.previousEmail) {
    await sendStorefrontEmailChangeNotice({
      to: result.previousEmail,
      storeName: ctx.store.name,
      newEmail: result.newEmail,
      resetUrl: storeUrl(ctx.store, '/account/profile'),
    });
  }

  revalidatePath('/account/profile');

  return {
    message: `Almost there — open the link we sent to ${result.newEmail}. Your address stays as it is until you do.`,
  };
}

/**
 * Step two: the link was opened, so the new inbox is proved.
 *
 * Deliberately NOT done on page load. A GET that spends a token is a token
 * spent by every mail scanner and link preview that touches the message, so
 * the page asks for one press first.
 *
 * The change retires every session, including the one that may be running in
 * this very browser — so if the person confirming is signed in as the
 * account that moved, their cookie is re-issued. Someone confirming in a
 * different browser (opening the link on their phone) simply isn't signed in
 * there, and the page offers sign-in.
 */
export async function confirmEmailChangeAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const slug = await currentStoreSlug();
  const store = slug ? await findStoreBySlug(slug) : null;
  if (!store) return { error: 'This link didn’t open on the right store.' };

  const token = String(formData.get('token') ?? '');
  if (!token) return { error: 'That link is incomplete. Open it straight from the email.' };

  const result = await confirmEmailChange({ organizationId: store.id, rawToken: token });

  if (!result.ok) {
    return {
      error:
        result.reason === 'email-taken'
          ? 'Someone else has taken that email address since you asked. Try again with another one.'
          : 'That link has expired or has already been used. Ask for a new one from your profile.',
    };
  }

  const current = await getShopper();
  if (current?.id === result.customer.id) {
    await keepSignedIn(store.slug, result.customer);
  }

  revalidatePath('/', 'layout');

  return { message: result.customer.email ?? '' };
}
