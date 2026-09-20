import { prisma } from '@/lib/prisma';

/**
 * Compares a JWT's sessionVersion claim against the user's current
 * sessionVersion in the database. Returns false (JWT must be rejected)
 * if the user no longer exists or the versions have diverged — which
 * happens whenever all previously issued JWTs are invalidated, e.g. on
 * password reset (see app/(auth)/reset-password/actions.ts).
 */
export async function isSessionVersionValid(
  userId: string,
  tokenSessionVersion: number | undefined,
): Promise<boolean> {
  const lookup = () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { sessionVersion: true },
    });

  /*
   * This runs on every auth() call, so a single dropped pooled connection
   * would otherwise bubble up as a JWTSessionError and break the whole
   * render. Retry once — the pool opens a fresh connection — but still throw
   * if it fails again rather than fail-open on an unverified session.
   */
  let user;
  try {
    user = await lookup();
  } catch {
    user = await lookup();
  }

  return !!user && user.sessionVersion === tokenSessionVersion;
}
