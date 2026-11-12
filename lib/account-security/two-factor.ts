/*
 * lib/account-security/two-factor.ts
 *
 * Two-step sign-in for staff (ROADMAP 14.5). Server only; the signed-in
 * person's own account — callers pass the session's user id, never one from
 * a form.
 *
 *   set up:   a new secret, kept as PENDING until a code from the app proves
 *             it was scanned; then it's the secret, and 10 backup codes are
 *             made — shown once, kept only as hashes.
 *   sign in:  the password is checked first; then a TWO_FACTOR ticket (in an
 *             httpOnly cookie) waits for a code. A correct code — from the app,
 *             or an unused backup code — marks it verified, and the
 *             'two-factor' sign-in (auth.ts) spends it, once.
 *   turn off: needs a current code, so a stolen session alone can't.
 *
 * An app code works once (`twoFactorLastStep`); a backup code once (`usedAt`).
 * Only for email-and-password sign-ins: Google and Apple have their own.
 */
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { prisma } from '@/lib/prisma';
import { open, seal } from '@/lib/social/crypto';
import { PLATFORM_NAME } from '@/lib/brand';
import { matchTotp, newTotpSecret, otpauthUri } from './totp';

export const RECOVERY_CODE_COUNT = 10;
const CHALLENGE_MS = 10 * 60_000;
const CHALLENGE_ATTEMPTS = 5;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

function newRecoveryCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const chars = Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await prisma.$transaction([
    prisma.userRecoveryCode.deleteMany({ where: { userId } }),
    prisma.userRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hash(normaliseRecovery(code)) })) }),
  ]);
  return codes;
}

/* ---------------- state ---------------- */

export interface TwoFactorStatus {
  enabled: boolean;
  /** backup codes not yet used */
  recoveryCodesLeft: number;
}

export async function twoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const [user, left] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabledAt: true } }),
    prisma.userRecoveryCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabled: Boolean(user?.twoFactorEnabledAt), recoveryCodesLeft: left };
}

/* ---------------- checking a code ---------------- */

/**
 * A code from the app (each works once) or an unused backup code (spent here).
 * The account must have two-step sign-in on.
 */
export async function checkSecondFactor(userId: string, rawCode: string, now = new Date()): Promise<'app' | 'recovery' | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorSecret: true, twoFactorEnabledAt: true, twoFactorLastStep: true } });
  if (!user?.twoFactorEnabledAt || !user.twoFactorSecret) return null;
  const code = rawCode.trim().replace(/\s/g, '');

  if (/^\d{6}$/.test(code)) {
    const step = matchTotp(open(user.twoFactorSecret), code, now);
    if (step === null) return null;
    // Each code once: only a later step than the last one used.
    const { count } = await prisma.user.updateMany({
      where: { id: userId, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
      data: { twoFactorLastStep: step },
    });
    return count ? 'app' : null;
  }

  const { count } = await prisma.userRecoveryCode.updateMany({
    where: { userId, codeHash: hash(normaliseRecovery(code)), usedAt: null },
    data: { usedAt: now },
  });
  return count ? 'recovery' : null;
}

/* ---------------- setting up and turning off ---------------- */

export interface SetupStart {
  /** for typing in by hand, grouped in fours */
  secret: string;
  /** a data: URL of the QR code to scan */
  qr: string;
}

export async function startTwoFactorSetup(userId: string): Promise<SetupStart | 'already-on' | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, password: true, twoFactorEnabledAt: true } });
  if (!user?.password) return null;
  if (user.twoFactorEnabledAt) return 'already-on';
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { twoFactorPendingSecret: seal(secret) } });
  const qr = await QRCode.toDataURL(otpauthUri({ issuer: PLATFORM_NAME, account: user.email, secret }), { margin: 1, width: 220 });
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr };
}

/** The app was set up: the pending secret becomes the secret, and the backup codes are made. */
export async function confirmTwoFactorSetup(userId: string, code: string, now = new Date()): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: 'wrong-code' | 'not-started' }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorPendingSecret: true, twoFactorEnabledAt: true } });
  if (!user?.twoFactorPendingSecret || user.twoFactorEnabledAt) return { ok: false, reason: 'not-started' };
  const step = matchTotp(open(user.twoFactorPendingSecret), code.trim(), now);
  if (step === null) return { ok: false, reason: 'wrong-code' };

  const { count } = await prisma.user.updateMany({
    where: { id: userId, twoFactorEnabledAt: null, twoFactorPendingSecret: user.twoFactorPendingSecret },
    data: { twoFactorSecret: user.twoFactorPendingSecret, twoFactorPendingSecret: null, twoFactorEnabledAt: now, twoFactorLastStep: step },
  });
  if (!count) return { ok: false, reason: 'not-started' };
  return { ok: true, recoveryCodes: await replaceRecoveryCodes(userId) };
}

export async function disableTwoFactor(userId: string, code: string): Promise<boolean> {
  if (!(await checkSecondFactor(userId, code))) return false;
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: null, twoFactorPendingSecret: null, twoFactorEnabledAt: null, twoFactorLastStep: null } }),
    prisma.userRecoveryCode.deleteMany({ where: { userId } }),
  ]);
  return true;
}

export async function regenerateRecoveryCodes(userId: string, code: string): Promise<string[] | null> {
  if (!(await checkSecondFactor(userId, code))) return null;
  return replaceRecoveryCodes(userId);
}

/* ---------------- the sign-in challenge ---------------- */

/** The password was right and two-step sign-in is on: a ticket that waits for the code. */
export async function createSignInChallenge(userId: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.authTicket.create({
    data: { userId, purpose: 'TWO_FACTOR', tokenHash: hash(token), expiresAt: new Date(now.getTime() + CHALLENGE_MS) },
  });
  return token;
}

export type ChallengeAnswer = 'ok' | 'wrong-code' | 'expired';

/** The code typed at sign-in. A correct one marks the ticket verified; too many wrong ones end it. */
export async function answerSignInChallenge(token: string, code: string, now = new Date()): Promise<ChallengeAnswer> {
  const ticket = await prisma.authTicket.findUnique({ where: { tokenHash: hash(token) } });
  if (!ticket || ticket.purpose !== 'TWO_FACTOR' || ticket.usedAt || ticket.verifiedAt || ticket.expiresAt < now || ticket.attempts >= CHALLENGE_ATTEMPTS) {
    return 'expired';
  }
  const counted = await prisma.authTicket.updateMany({
    where: { id: ticket.id, attempts: { lt: CHALLENGE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (!counted.count) return 'expired';
  if (!(await checkSecondFactor(ticket.userId, code, now))) return 'wrong-code';
  await prisma.authTicket.update({ where: { id: ticket.id }, data: { verifiedAt: now } });
  return 'ok';
}

/** For the 'two-factor' sign-in (auth.ts): a verified ticket, spent once, gives its user. */
export async function spendSignInChallenge(token: unknown, now = new Date()): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20) return null;
  const { count } = await prisma.authTicket.updateMany({
    where: { tokenHash: hash(token), purpose: 'TWO_FACTOR', verifiedAt: { not: null }, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (!count) return null;
  const ticket = await prisma.authTicket.findUnique({ where: { tokenHash: hash(token) }, select: { userId: true } });
  return ticket?.userId ?? null;
}

/** Does this account need a code after its password? */
export async function needsSecondFactor(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabledAt: true } });
  return Boolean(user?.twoFactorEnabledAt);
}
