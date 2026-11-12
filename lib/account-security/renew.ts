/*
 * lib/account-security/renew.ts
 *
 * Spending the RENEW ticket that keeps this session when every other one is
 * signed out (./sessions.ts). Its own file, free of `@/auth`, because auth.ts
 * calls it.
 */
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export const hashTicket = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * For auth.ts's jwt callback: the account's current session version, if the
 * ticket is good — and whether this session has just proved a second factor
 * (two-step sign-in was turned on with a code), which makes it a two-step one.
 */
export async function spendRenewTicket(userId: string, token: unknown, now = new Date()): Promise<{ version: number; provedSecondFactor: boolean } | null> {
  if (typeof token !== 'string' || token.length < 20) return null;
  const ticket = await prisma.authTicket.findUnique({ where: { tokenHash: hashTicket(token) }, select: { id: true, userId: true, verifiedAt: true } });
  if (!ticket || ticket.userId !== userId) return null;
  const { count } = await prisma.authTicket.updateMany({
    where: { id: ticket.id, purpose: 'RENEW', usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (!count) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  return user ? { version: user.sessionVersion, provedSecondFactor: ticket.verifiedAt !== null } : null;
}

/** For the daily data-retention job: sign-in tickets and email changes long past use. */
export async function purgeExpiredAuthTickets(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
  await Promise.all([
    prisma.authTicket.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.userEmailChange.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]);
}
