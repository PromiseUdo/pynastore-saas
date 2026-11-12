/*
 * lib/account-security/sessions.ts
 *
 * Signing out every other device (ROADMAP 14.5). Sessions are JWTs checked
 * against `User.sessionVersion` on every request (lib/session-version.ts), so
 * raising it ends every session at once — this one too. To keep THIS one, a
 * RENEW ticket is made and spent inside the same server action
 * (`unstable_update`); a browser can't make one, so it can't revive a session
 * that was signed out. Server actions only.
 */
import { randomBytes } from 'node:crypto';
import { unstable_update } from '@/auth';
import { prisma } from '@/lib/prisma';
import { STRONG_SIGN_INS, isStrongSignIn } from './strong-sign-in';

export { STRONG_SIGN_INS, isStrongSignIn };

import { hashTicket } from './renew';

const hash = hashTicket;
const RENEW_MS = 60_000;

/**
 * End every session but this one. `provedSecondFactor`: this person has just
 * typed a code (turning two-step sign-in on), so this session now counts as
 * a two-step one.
 */
export async function signOutOtherSessions(userId: string, { provedSecondFactor = false }: { provedSecondFactor?: boolean } = {}): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await prisma.authTicket.create({
    data: { userId, purpose: 'RENEW', tokenHash: hash(token), expiresAt: new Date(now.getTime() + RENEW_MS), verifiedAt: provedSecondFactor ? now : null },
  });
  await unstable_update({ renewTicket: token } as never);
}
