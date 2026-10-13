/*
 * lib/business-app/handoff-user.ts
 *
 * Who a business-app sign-in ticket signs in (ROADMAP 19.2) — the
 * "app-handoff" provider's check in auth.ts, kept here so it can be tested
 * without Auth.js around it. Server only.
 */
import { prisma } from '@/lib/prisma';
import { consumeAppTicket } from './tickets';

export async function userForAppTicket(token: unknown, verifier: unknown) {
  const claims = await consumeAppTicket('sign-in', typeof token === 'string' ? token : null, {
    verifier: typeof verifier === 'string' ? verifier : null,
  });
  if (!claims || typeof claims.userId !== 'string') return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, name: true, image: true, sessionVersion: true },
  });
  // A password reset since the ticket was minted ends it too.
  if (!user || user.sessionVersion !== claims.sessionVersion) return null;
  return user;
}
