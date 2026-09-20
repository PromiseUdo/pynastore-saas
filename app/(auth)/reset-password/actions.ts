'use server';

import { createHash } from 'crypto';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const ResetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ResetPasswordState = { error: string } | { success: true } | null;

const INVALID_TOKEN_ERROR =
  'This password reset link is invalid or has expired. Please request a new one.';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = ResetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  // Same generic error whether the token doesn't exist, expired, or was
  // already used — don't give an attacker signal about which case it is.
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { error: INVALID_TOKEN_ERROR };
  }

  const hashedPassword = await hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      // Bumping sessionVersion invalidates every JWT issued before this
      // point — auth.ts's jwt() callback rejects any token whose
      // sessionVersion claim no longer matches. See auth.ts for the
      // corresponding check.
      data: { password: hashedPassword, sessionVersion: { increment: 1 } },
    }),
    // Invalidate every outstanding reset token for this user, not just
    // the one that was used.
    prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } }),
    // Best-effort hygiene: clear any DB-backed sessions too, in case this
    // app ever adds a database-strategy provider.
    prisma.session.deleteMany({ where: { userId: resetToken.userId } }),
  ]);

  return { success: true };
}
