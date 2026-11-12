/*
 * lib/account-security/password-sign-in.ts
 *
 * The password provider's check (auth.ts). An account with two-step sign-in
 * on is never signed in by its password alone (ROADMAP 14.5): the login
 * action checks the password itself and then asks for the code, and only the
 * 'two-factor' provider finishes it. Anyone posting straight to the
 * credentials endpoint gets nowhere. Server only.
 */
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function userForPassword(raw: unknown) {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, image: true, password: true, sessionVersion: true, twoFactorEnabledAt: true },
  });
  // OAuth-only accounts have no stored password.
  if (!user?.password) return null;
  if (!(await compare(password, user.password))) return null;
  // Two-step sign-in is on: the password alone is never enough.
  if (user.twoFactorEnabledAt) return null;

  return { id: user.id, email: user.email, name: user.name, image: user.image, sessionVersion: user.sessionVersion };
}
