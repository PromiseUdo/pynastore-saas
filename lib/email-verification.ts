/*
 * lib/email-verification.ts
 *
 * Confirming a merchant's email before they create a shop (ROADMAP 12.5):
 * a workspace, a trial and later a payout account shouldn't hang off an
 * address nobody has shown they own. Server only.
 *
 * Tokens reuse Auth.js's VerificationToken table: the identifier names the
 * user, and only the SHA-256 of the token is stored. Single use; 48 hours.
 * Google sign-ins and accepted invitations are verified by what they are
 * (Google checked the address; the invitation reached it).
 */
import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { verifyEmail } from '@/lib/onboarding/emails';

export const VERIFY_TTL_HOURS = 48;
/** Don't send another link within this long of the last. */
const RESEND_COOLDOWN_MS = 60_000;

const identifierFor = (userId: string) => `verify-email:${userId}`;
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

export async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  return Boolean(user?.emailVerified);
}

export async function markEmailVerified(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId, emailVerified: null }, data: { emailVerified: new Date() } });
}

/**
 * Emails a fresh link, replacing any earlier one. Returns 'sent', or
 * 'too-soon' inside the cooldown, or 'already' when there's nothing to do.
 */
export async function sendVerificationEmail(userId: string, now = new Date()): Promise<'sent' | 'too-soon' | 'already' | 'failed'> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, emailVerified: true } });
  if (!user) return 'failed';
  if (user.emailVerified) return 'already';

  const identifier = identifierFor(userId);
  const latest = await prisma.verificationToken.findFirst({ where: { identifier }, orderBy: { expires: 'desc' } });
  if (latest) {
    const issuedAt = latest.expires.getTime() - VERIFY_TTL_HOURS * 3600_000;
    if (now.getTime() - issuedAt < RESEND_COOLDOWN_MS) return 'too-soon';
  }

  const raw = randomBytes(32).toString('hex');
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token: hash(raw), expires: new Date(now.getTime() + VERIFY_TTL_HOURS * 3600_000) },
    }),
  ]);

  const email = verifyEmail({
    name: user.name,
    url: getMarketingUrl(`/verify-email/${raw}`),
    expiresInHours: VERIFY_TTL_HOURS,
  });
  const sent = await sendPlatformNoticeEmail({ to: user.email, ...email });
  return sent ? 'sent' : 'failed';
}

/** Uses a link. The user it belongs to is verified; the link can't be used again. */
export async function confirmEmailToken(
  raw: string,
  now = new Date(),
): Promise<{ ok: true; userId: string } | { ok: false; reason: 'invalid' | 'expired' }> {
  if (!/^[a-f0-9]{64}$/.test(raw)) return { ok: false, reason: 'invalid' };
  const row = await prisma.verificationToken.findUnique({ where: { token: hash(raw) } });
  if (!row || !row.identifier.startsWith('verify-email:')) return { ok: false, reason: 'invalid' };
  const userId = row.identifier.slice('verify-email:'.length);
  await prisma.verificationToken.deleteMany({ where: { token: row.token } });
  if (row.expires <= now) return { ok: false, reason: 'expired' };
  await markEmailVerified(userId);
  return { ok: true, userId };
}
