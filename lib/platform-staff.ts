/*
 * lib/platform-staff.ts
 *
 * Who may use the platform console (ROADMAP 11.1). Server only.
 *
 * Platform staff is a flag on the USER, not a role: roles belong to one
 * organization, and the console acts across all of them. The flag is read
 * from the database on every request rather than carried in the session
 * token, so revoking it takes effect immediately.
 *
 * The console's pages answer a non-staff visitor with a 404 rather than an
 * access-denied page — there's no reason to confirm to a merchant that it
 * exists.
 */
import { cache } from 'react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export interface PlatformStaff {
  userId: string;
  name: string;
  email: string;
}

export class PlatformAccessDeniedError extends Error {
  constructor() {
    super('Not platform staff');
    this.name = 'PlatformAccessDeniedError';
  }
}

/** The signed-in user if they are platform staff; otherwise null. */
export const getPlatformStaff = cache(async (): Promise<PlatformStaff | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, isPlatformStaff: true },
  });
  if (!user?.isPlatformStaff) return null;
  return { userId: user.id, name: user.name ?? user.email, email: user.email };
});

/** For server actions: the staff member, or PlatformAccessDeniedError. */
export async function requirePlatformStaff(): Promise<PlatformStaff> {
  const staff = await getPlatformStaff();
  if (!staff) throw new PlatformAccessDeniedError();
  return staff;
}
