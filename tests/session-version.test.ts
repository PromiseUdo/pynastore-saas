import { randomBytes, createHash } from 'crypto';
import { compare, hash } from 'bcryptjs';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { isSessionVersionValid } from '@/lib/session-version';
import { resetPasswordAction } from '@/app/(auth)/reset-password/actions';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

async function createTestUser(password: string) {
  return prisma.user.create({
    data: {
      email: `__test_session_version_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
      password: await hash(password, 12),
      name: 'Session Version Test',
    },
  });
}

async function createResetToken(userId: string) {
  const rawToken = randomBytes(32).toString('base64url');
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  return rawToken;
}

function resetFormData(token: string, password: string) {
  const formData = new FormData();
  formData.set('token', token);
  formData.set('password', password);
  formData.set('confirmPassword', password);
  return formData;
}

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop()!;
    await prisma.passwordResetToken.deleteMany({ where: { userId: id } });
    await prisma.user.deleteMany({ where: { id } });
  }
});

describe('sessionVersion', () => {
  it('treats a JWT carrying the current sessionVersion as valid', async () => {
    const user = await createTestUser('OldPassword123');
    createdUserIds.push(user.id);

    expect(user.sessionVersion).toBe(0);
    await expect(isSessionVersionValid(user.id, 0)).resolves.toBe(true);
  });

  it('treats a JWT carrying a stale sessionVersion as invalid', async () => {
    const user = await createTestUser('OldPassword123');
    createdUserIds.push(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });

    // The JWT that was issued before the bump still carries version 0.
    await expect(isSessionVersionValid(user.id, 0)).resolves.toBe(false);
    // A freshly issued JWT with the new version is valid.
    await expect(isSessionVersionValid(user.id, 1)).resolves.toBe(true);
  });

  it('increments sessionVersion on a successful password reset', async () => {
    const user = await createTestUser('OldPassword123');
    createdUserIds.push(user.id);
    const rawToken = await createResetToken(user.id);

    const result = await resetPasswordAction(
      null,
      resetFormData(rawToken, 'NewPassword456'),
    );

    expect(result).toEqual({ success: true });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.sessionVersion).toBe(1);
  });

  it('invalidates every JWT issued before a password reset, but not the new one', async () => {
    const user = await createTestUser('OldPassword123');
    createdUserIds.push(user.id);
    const rawToken = await createResetToken(user.id);

    // Simulate a JWT that was issued (and cached client-side) prior to reset.
    const staleJwtSessionVersion = user.sessionVersion;
    await expect(
      isSessionVersionValid(user.id, staleJwtSessionVersion),
    ).resolves.toBe(true);

    await resetPasswordAction(null, resetFormData(rawToken, 'NewPassword456'));

    // The pre-reset JWT is now rejected...
    await expect(
      isSessionVersionValid(user.id, staleJwtSessionVersion),
    ).resolves.toBe(false);
    // ...while a JWT stamped with the post-reset version is accepted.
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(
      isSessionVersionValid(user.id, refreshed.sessionVersion),
    ).resolves.toBe(true);

    // The reset token itself, and any siblings, must be gone too.
    const remainingTokens = await prisma.passwordResetToken.count({
      where: { userId: user.id },
    });
    expect(remainingTokens).toBe(0);
  });

  it('lets the user log in with the new password and mints a JWT with the new sessionVersion', async () => {
    const user = await createTestUser('OldPassword123');
    createdUserIds.push(user.id);
    const rawToken = await createResetToken(user.id);

    await resetPasswordAction(null, resetFormData(rawToken, 'NewPassword456'));

    // Exercises the same lookup + compare + sessionVersion selection that
    // auth.ts's Credentials.authorize() performs, without needing a full
    // Next.js request context to invoke NextAuth's HTTP handlers directly.
    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true, password: true, sessionVersion: true },
    });

    expect(dbUser).not.toBeNull();
    await expect(compare('NewPassword456', dbUser!.password!)).resolves.toBe(true);
    await expect(compare('OldPassword123', dbUser!.password!)).resolves.toBe(false);

    // The JWT minted at this login would carry this sessionVersion, which
    // must match what's now stored (i.e. the post-reset value).
    expect(dbUser!.sessionVersion).toBe(1);
    await expect(
      isSessionVersionValid(dbUser!.id, dbUser!.sessionVersion),
    ).resolves.toBe(true);
  });
});
