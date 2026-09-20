'use server';

import { hash } from 'bcryptjs';
import { signIn } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AuthError } from 'next-auth';
import { z } from 'zod';

const RegisterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type RegisterState = { error: string } | null;

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = RegisterSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    return { error: 'An account with this email already exists.' };
  }

  const hashedPassword = await hash(password, 12);

  await prisma.user.create({
    data: { name, email, password: hashedPassword },
  });

  // If an invite token was passed through the form, redirect back to the invite page
  // after sign-in. ?auto=1 tells the invite page to accept immediately without
  // requiring an extra button click.
  const inviteToken = formData.get('invite') as string | null;
  const redirectTo = inviteToken ? `/invite/${inviteToken}?auto=1` : '/onboarding';

  try {
    await signIn('credentials', { email, password, redirectTo });
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        error: 'Account created but sign-in failed. Please log in manually.',
      };
    }
    throw err;
  }

  return null;
}

export async function googleSignInAction(formData: FormData) {
  const inviteToken = formData.get('invite') as string | null;
  const redirectTo = inviteToken ? `/invite/${inviteToken}?auto=1` : '/onboarding';
  await signIn('google', { redirectTo });
}
