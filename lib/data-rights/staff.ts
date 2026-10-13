/*
 * lib/data-rights/staff.ts
 *
 * A staff member deletes their own account (ROADMAP 19.3, NDPA). The app
 * stores require it of any app you can sign up in (Apple 5.1.1(v)), and it
 * belongs on every surface, not only in the app.
 *
 * The person's `users` row is KEPT: orders they rang up, audit entries and
 * answered questions still point at it, and those are the shop's business
 * records (policy.ts). Everything that identified or reached them goes:
 *
 *   - gone now: their sign-in (password, Google and Apple links, every
 *     session, reset and confirmation links), their memberships in every
 *     shop, their notifications, notification choices, phones and browsers,
 *     platform staff access;
 *   - the row itself: the name becomes "Former member" and the email a
 *     placeholder that can't receive mail, so anywhere that shows "name or
 *     email" now shows "Former member", and the address is free to sign up
 *     with again.
 *
 * One rule first: a shop can't be left without an Owner. Someone who is the
 * only Owner of an open (or suspended) shop must make another member an
 * Owner, or close the shop, before deleting. Closed shops don't count.
 */
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { SYSTEM_ROLES } from '@/lib/permissions';

export const FORMER_MEMBER = 'Former member';

/** The address a deleted account keeps: unique, and `.invalid` never delivers. */
export const deletedEmailFor = (userId: string) => `deleted-${userId}@deleted.invalid`;

export interface DeletionBlocker {
  name: string;
  slug: string;
}

/** Shops this person is the ONLY Owner of, while they're open or suspended. */
export async function staffDeletionBlockers(userId: string): Promise<DeletionBlocker[]> {
  const owned = await prisma.membership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      role: { isSystem: true, name: SYSTEM_ROLES.OWNER.name },
      organization: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
    },
    select: {
      organization: {
        select: {
          name: true,
          slug: true,
          _count: {
            select: {
              memberships: { where: { status: 'ACTIVE', userId: { not: userId }, role: { isSystem: true, name: SYSTEM_ROLES.OWNER.name } } },
            },
          },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
  return owned.filter((m) => m.organization._count.memberships === 0).map((m) => ({ name: m.organization.name, slug: m.organization.slug }));
}

export type StaffDeletionResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'wrong-confirmation' }
  | { ok: false; reason: 'sole-owner'; shops: DeletionBlocker[] };

/** How this person confirms: their password, or — with none — by typing their email. */
export async function confirmationKind(userId: string): Promise<'password' | 'email' | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { password: true } });
  if (!user) return null;
  return user.password ? 'password' : 'email';
}

export async function deleteStaffAccount(userId: string, confirmation: string, now = new Date()): Promise<StaffDeletionResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, password: true },
  });
  if (!user) return { ok: false, reason: 'not-found' };

  const confirmed = user.password
    ? await compare(confirmation, user.password)
    : confirmation.trim().toLowerCase() === user.email.toLowerCase();
  if (!confirmed) return { ok: false, reason: 'wrong-confirmation' };

  const shops = await staffDeletionBlockers(userId);
  if (shops.length > 0) return { ok: false, reason: 'sole-owner', shops };

  // Each shop they leave sees it in its activity, under the name they'll now show as.
  const memberships = await prisma.membership.findMany({ where: { userId, status: 'ACTIVE' }, select: { id: true, organizationId: true } });

  await prisma.$transaction([
    prisma.account.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.verificationToken.deleteMany({ where: { identifier: `verify-email:${userId}` } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.notificationPreference.deleteMany({ where: { userId } }),
    prisma.webPushSubscription.deleteMany({ where: { userId } }),
    prisma.pushDevice.deleteMany({ where: { userId } }),
    // Every shop: active, removed and closed alike. Their store access goes with it.
    prisma.membership.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        name: FORMER_MEMBER,
        email: deletedEmailFor(userId),
        emailVerified: null,
        image: null,
        password: null,
        isPlatformStaff: false,
        // Every session already issued ends on its next request (lib/session-version.ts).
        sessionVersion: { increment: 1 },
        deletedAt: now,
      },
    }),
  ]);

  for (const m of memberships) {
    await createAuditLog({
      organizationId: m.organizationId,
      userId,
      action: 'staff.account.deleted',
      entityType: 'Membership',
      entityId: m.id,
      metadata: {},
    });
  }
  return { ok: true };
}
