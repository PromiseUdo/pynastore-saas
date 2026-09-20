'use server';

import { signIn } from '@/lib/auth';
import { AuthError } from 'next-auth';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginState = { error: string } | null;

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Support callbackUrl for invite flow (e.g. /login?callbackUrl=/invite/TOKEN)
  const callbackUrl = formData.get('callbackUrl') as string | null;
  const redirectTo = callbackUrl ?? '/';

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

export async function googleSignInAction() {
  await signIn('google', { redirectTo: '/' });
}
