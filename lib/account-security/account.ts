/*
 * lib/account-security/account.ts
 *
 * A staff member's own profile and password (ROADMAP 14.5). Server only; the
 * caller passes the session's user id. Signing out other devices and the
 * emails are the action's (features/account/security.ts).
 *
 * EMAIL CHANGES. The account doesn't move until the link sent to the NEW
 * address is opened, and the OLD address is told at once — the only warning
 * someone gets if another person is moving their account. A person with a
 * password confirms it first.
 */
import { createHash, randomBytes } from 'node:crypto';
import { compare, hash as bcryptHash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const MIN_PASSWORD = 8;
const EMAIL_CHANGE_MS = 24 * 60 * 60_000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export async function updateName(userId: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80) return { ok: false, error: 'Enter your name, 2 to 80 characters.' };
  await prisma.user.update({ where: { id: userId }, data: { name: clean } });
  return { ok: true };
}

export type PasswordChange = { ok: true; email: string } | { ok: false; field: 'current' | 'next'; error: string };

export async function changePassword(userId: string, input: { current: string; next: string }): Promise<PasswordChange> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { email: true, password: true } });
  if (!user?.password) return { ok: false, field: 'current', error: 'This account signs in with Google or Apple, so it has no password to change.' };
  if (!(await compare(input.current, user.password))) return { ok: false, field: 'current', error: 'That isn’t your current password.' };
  if (input.next.length < MIN_PASSWORD) return { ok: false, field: 'next', error: `Use at least ${MIN_PASSWORD} characters.` };
  if (input.next.length > 200) return { ok: false, field: 'next', error: 'Keep it under 200 characters.' };
  if (await compare(input.next, user.password)) return { ok: false, field: 'next', error: 'Choose a password you haven’t used here.' };
  await prisma.user.update({ where: { id: userId }, data: { password: await bcryptHash(input.next, 12) } });
  return { ok: true, email: user.email };
}

/* ---------------- email changes ---------------- */

export type EmailChangeRequest =
  /** `deliver`: false when the address is taken — say nothing, send nothing to it */
  | { ok: true; token: string; oldEmail: string; newEmail: string; deliver: boolean }
  | { ok: false; field: 'email' | 'password'; error: string };

export async function requestEmailChange(userId: string, input: { newEmail: string; password: string }, now = new Date()): Promise<EmailChangeRequest> {
  const newEmail = input.newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 160) return { ok: false, field: 'email', error: 'Enter a valid email address.' };
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { email: true, password: true } });
  if (!user) return { ok: false, field: 'email', error: 'Sign in again to continue.' };
  if (newEmail === user.email.toLowerCase()) return { ok: false, field: 'email', error: 'That’s already your email.' };
  if (user.password && !(await compare(input.password, user.password))) return { ok: false, field: 'password', error: 'That isn’t your password.' };
  // Same words whether or not it's taken: this mustn't reveal who has an account.
  const taken = await prisma.user.findFirst({ where: { email: { equals: newEmail, mode: 'insensitive' } }, select: { id: true } });

  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.userEmailChange.deleteMany({ where: { userId, usedAt: null } }),
    prisma.userEmailChange.create({ data: { userId, newEmail, tokenHash: sha(taken ? `taken:${token}` : token), expiresAt: new Date(now.getTime() + EMAIL_CHANGE_MS) } }),
  ]);
  return { ok: true, token, oldEmail: user.email, newEmail, deliver: !taken };
}

/** The link from the new address was opened: the account moves, if the address is still free. */
export async function confirmEmailChange(token: string, now = new Date()): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const change = await prisma.userEmailChange.findUnique({ where: { tokenHash: sha(token) } });
  if (!change || change.usedAt || change.expiresAt < now) return { ok: false, error: 'This link has expired or was already used. Ask for a new one from Your account.' };
  const taken = await prisma.user.findFirst({ where: { email: { equals: change.newEmail, mode: 'insensitive' }, NOT: { id: change.userId } }, select: { id: true } });
  if (taken) return { ok: false, error: 'That email now belongs to another account, so yours wasn’t changed.' };

  const { count } = await prisma.userEmailChange.updateMany({ where: { id: change.id, usedAt: null }, data: { usedAt: now } });
  if (!count) return { ok: false, error: 'This link was already used.' };
  await prisma.user.update({ where: { id: change.userId }, data: { email: change.newEmail, emailVerified: now } });
  return { ok: true, email: change.newEmail };
}
