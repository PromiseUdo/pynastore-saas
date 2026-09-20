'use server';

import { hash } from 'bcryptjs';
import { signIn } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AuthError } from 'next-auth';
import { z } from 'zod';

const SignUpSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Sign up a new user with email/password.
 * Does NOT create an organization — that happens in onboarding.
 * On success, signs the user in and redirects to /onboarding.
 */
export async function signUp(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = SignUpSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    return { success: false, error: 'An account with this email already exists.' };
  }

  const hashedPassword = await hash(password, 12);

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword },
    select: { id: true },
  });

  // Redirect destination: check for invite token in formData
  const invite = formData.get('invite') as string | null;
  const redirectTo = invite ? `/invite/${invite}` : '/onboarding';

  try {
    await signIn('credentials', { email, password, redirectTo });
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        success: false,
        error: 'Account created but sign-in failed. Please log in manually.',
      };
    }
    throw err;
  }

  return { success: true, data: { id: user.id } };
}
