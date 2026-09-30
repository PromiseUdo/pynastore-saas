/*
 * features/platform/overview.ts
 *
 * The figures on the console's front page (ROADMAP 11.0), plus the number the
 * sidebar shows beside Verification. Platform staff only; read-only.
 *
 * A workspace's plan state is worked out with the same rule the merchant's own
 * dashboard uses (lib/billing/access.ts), but nothing is recorded here: a
 * lapse is written the first time the merchant's side sees it, never because
 * staff happened to look.
 */
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { getBillingSettings } from '@/lib/settings';
import { resolveAccess, type AccessState } from '@/lib/billing/access';

export interface ConsoleOverview {
  verification: { pending: number; oldestSubmittedAt: Date | null };
  workspaces: {
    total: number;
    newThisWeek: number;
    suspended: number;
    byState: Record<AccessState, number>;
  };
}

const DAY = 24 * 60 * 60 * 1000;

/** Submissions waiting for review — the sidebar's badge. */
export async function pendingVerificationCount(): Promise<number> {
  await requirePlatformStaff();
  return prisma.merchantPaymentAccount.count({ where: { verificationStatus: 'PENDING' } });
}

export async function getConsoleOverview(now = new Date()): Promise<ConsoleOverview> {
  await requirePlatformStaff();

  const [pending, oldest, orgs, newThisWeek, suspended, { graceDays }] = await Promise.all([
    prisma.merchantPaymentAccount.count({ where: { verificationStatus: 'PENDING' } }),
    prisma.merchantPaymentAccount.findFirst({
      where: { verificationStatus: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      select: { submittedAt: true },
    }),
    prisma.organization.findMany({
      where: { status: 'ACTIVE' },
      select: {
        subscription: {
          select: {
            status: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            lapsedAt: true,
            graceEndsAt: true,
          },
        },
      },
    }),
    prisma.organization.count({ where: { status: { not: 'DELETED' }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    prisma.organization.count({ where: { status: 'SUSPENDED' } }),
    getBillingSettings(),
  ]);

  const byState: Record<AccessState, number> = { trial: 0, active: 0, grace: 0, lapsed: 0, none: 0 };
  for (const org of orgs) byState[resolveAccess(org.subscription, now, graceDays).state] += 1;

  return {
    verification: { pending, oldestSubmittedAt: oldest?.submittedAt ?? null },
    workspaces: { total: orgs.length, newThisWeek, suspended, byState },
  };
}
