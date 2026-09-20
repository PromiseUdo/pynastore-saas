'use server';

import { randomBytes, createHash } from 'crypto';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';

const ForgotPasswordSchema = z.object({
  email: z.email(),
});

export type ForgotPasswordState = { message: string } | null;

// Token is single-use and expires quickly, so a 256-bit random value is
// more than enough entropy — only its SHA-256 hash is ever persisted.
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MINUTES = 30;

const GENERIC_MESSAGE =
  'If an account exists for this email address, you will receive a password reset link shortly.';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

async function getClientIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return headerList.get('x-real-ip') ?? 'unknown';
}

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = ForgotPasswordSchema.safeParse({
    email: formData.get('email'),
  });

  // Even a malformed email gets the generic message — don't hint at
  // what's wrong beyond basic client-side format validation.
  if (!parsed.success) {
    return { message: GENERIC_MESSAGE };
  }

  const email = parsed.data.email.trim();

  const ip = await getClientIp();
  const emailKey = hashToken(email.toLowerCase());

  // IP: 10 requests / 15 min. Email: 5 requests / 15 min. Both are
  // deliberately generous since a false positive here just delays a
  // legitimate reset; the DB-backed per-user cooldown below is what
  // actually stops inbox spam.
  const ipAllowed = checkRateLimit(
    `forgot-password:ip:${ip}`,
    10,
    15 * 60 * 1000,
  );
  const emailAllowed = checkRateLimit(
    `forgot-password:email:${emailKey}`,
    5,
    15 * 60 * 1000,
  );

  if (!ipAllowed || !emailAllowed) {
    return { message: GENERIC_MESSAGE };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (user) {
    // DB-backed cooldown: don't issue a new token (and email) if one was
    // already sent very recently — protects against re-send abuse even
    // across processes/instances, unlike the in-memory limiter above.
    const recentToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        createdAt: { gt: new Date(Date.now() - 60 * 1000) },
      },
      select: { id: true },
    });

    if (!recentToken) {
      const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(
        Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
      );

      await prisma.$transaction([
        // Invalidate any previously issued tokens for this user.
        prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
        prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
        }),
      ]);

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

      await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      });
    }
  }

  return { message: GENERIC_MESSAGE };
}
