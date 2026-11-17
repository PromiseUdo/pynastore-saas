'use server';

import { cookies, headers } from 'next/headers';
import { compare } from 'bcryptjs';
import { signIn } from '@/lib/auth';
import { AuthError } from 'next-auth';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { isBusinessRequest, signInTargetHere } from '@/lib/tenant/here';
import { signedInHomeUrl } from '@/lib/tenant/signed-in-home';
import { answerSignInChallenge, challengeUserId, createSignInChallenge } from '@/lib/account-security/two-factor';

/* Two-step sign-in (ROADMAP 14.5): after a right password, the ticket that
 * waits for the code lives here — httpOnly, so no page script can read it. */
const CHALLENGE_COOKIE = 'two-factor-challenge';

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginState =
  | { error: string }
  /** the password was right; now the code from their authenticator app */
  | { step: 'code'; callbackUrl: string | null; error?: string }
  | null;

export async function loginAction(
  prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // The code step posts to the same action, so the page always shows the latest answer.
  if (formData.get('intent') === 'code') return verifyTwoFactor(prev, formData);

  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  /* Password guessing: at most 10 tries per account and 30 per connection
   * in 15 minutes. Counted before the password is looked at, right or wrong. */
  const jarHeaders = await headers();
  const ip = jarHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || jarHeaders.get('x-real-ip') || 'unknown';
  const allowed =
    (await checkRateLimit(`sign-in:ip:${ip}`, 30, 15 * 60 * 1000)) &&
    (await checkRateLimit(`sign-in:email:${parsed.data.email.toLowerCase()}`, 10, 15 * 60 * 1000));
  if (!allowed) return { error: 'Too many sign-in attempts. Wait 15 minutes, or reset your password.' };

  // Support callbackUrl for invite flow (e.g. /login?callbackUrl=/invite/TOKEN)
  const callbackUrl = formData.get('callbackUrl') as string | null;
  // On the business host a relative target is made absolute there (ROADMAP 19).

  /* Two-step sign-in on: check the password here, then ask for the code.
   * (The password provider refuses such an account, so this is the only way in.) */
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, password: true, twoFactorEnabledAt: true, deletedAt: true },
  });
  if (user?.twoFactorEnabledAt && user.password && !user.deletedAt) {
    if (!(await compare(parsed.data.password, user.password))) return { error: 'Invalid email or password.' };
    const token = await createSignInChallenge(user.id);
    (await cookies()).set(CHALLENGE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60,
    });
    return { step: 'code', callbackUrl };
  }

  const redirectTo = await afterSignIn(callbackUrl, user && !user.deletedAt ? user.id : null);
  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      switch (err.type) {
        case 'CredentialsSignin':
          return { error: 'Invalid email or password.' };
        default:
          return { error: 'Something went wrong. Please try again.' };
      }
    }
    // Re-throw: Next.js uses a thrown NEXT_REDIRECT internally
    throw err;
  }

  return null;
}

/**
 * Where to go once signed in. A specific page that asked (an invite, a
 * deep link) is honoured as before; plain "home" becomes the person's own
 * dashboard address, worked out here — see lib/tenant/signed-in-home.ts.
 */
async function afterSignIn(callbackUrl: string | null, userId: string | null | undefined): Promise<string> {
  const target = callbackUrl || '/';
  if (target === '/' && userId && !(await isBusinessRequest())) return signedInHomeUrl(userId);
  return signInTargetHere(target);
}

/** Step two: the code from the authenticator app, or a backup code. */
async function verifyTwoFactor(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  const callbackUrl = (formData.get('callbackUrl') as string | null) || null;
  if (!token) return { error: 'Your sign-in timed out. Please enter your password again.' };
  if (!(await checkRateLimit(`two-factor-sign-in:${token.slice(0, 16)}`, 10, 10 * 60 * 1000))) {
    return { error: 'Too many attempts. Please wait a few minutes and try again.' };
  }

  const code = String(formData.get('code') ?? '').trim();
  const answer = await answerSignInChallenge(token, code);
  if (answer === 'expired') {
    jar.delete(CHALLENGE_COOKIE);
    return { error: 'Your sign-in timed out. Please enter your password again.' };
  }
  if (answer === 'wrong-code') return { step: 'code', callbackUrl, error: 'That code isn’t right. Try the newest one in your app.' };

  jar.delete(CHALLENGE_COOKIE);
  const redirectTo = await afterSignIn(callbackUrl, await challengeUserId(token));
  try {
    await signIn('two-factor', { ticket: token, redirectTo });
  } catch (err) {
    if (err instanceof AuthError) return { error: 'Something went wrong. Please sign in again.' };
    throw err;
  }
  return null;
}

export async function googleSignInAction(formData: FormData) {
  await signIn('google', { redirectTo: await signInTargetHere(callbackFrom(formData)) });
}

/** Sign in with Apple (ROADMAP 19.2) — offered only when it's configured. */
export async function appleSignInAction(formData: FormData) {
  await signIn('apple', { redirectTo: await signInTargetHere(callbackFrom(formData)) });
}

/** Where a Google or Apple sign-in returns to: the page that asked, or home. */
function callbackFrom(formData: FormData): string {
  const value = formData.get('callbackUrl');
  return typeof value === 'string' && value ? value : '/';
}
