/*
 * lib/onboarding/reminders.ts
 *
 * The onboarding reminders (ROADMAP 12.5), sent by a daily job
 * (app/api/cron/onboarding-reminders):
 *   - setup_day_3, setup_day_7 — on days 3 and 7 of a trial, only while the
 *     shop isn't open, listing what's left;
 *   - trial_ends_3d, trial_ends_1d — before a trial ends.
 *
 * Each (workspace, kind) is claimed with a unique row BEFORE sending, so two
 * runs, or a run that retries, never send it twice; a send that fails
 * releases its claim so tomorrow's run tries again. A workspace that's
 * suspended or deleted gets nothing.
 */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getAdminUrl } from '@/lib/tenant/urls';
import { getBillingSettings } from '@/lib/settings';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { setupProgressFor } from './setup-guide';
import { setupReminderEmail, trialEndingEmail } from './emails';

const DAY = 24 * 60 * 60 * 1000;

export type ReminderKind = 'setup_day_3' | 'setup_day_7' | 'trial_ends_3d' | 'trial_ends_1d';

/** Which setup reminder is due for a workspace created at `createdAt`, if any. */
export function setupReminderDue(createdAt: Date, now: Date): 'setup_day_3' | 'setup_day_7' | null {
  const age = (now.getTime() - createdAt.getTime()) / DAY;
  if (age >= 7 && age < 14) return 'setup_day_7';
  if (age >= 3 && age < 7) return 'setup_day_3';
  return null;
}

/** Which trial reminder is due for a trial ending at `endsAt`, if any. */
export function trialReminderDue(endsAt: Date, now: Date): 'trial_ends_3d' | 'trial_ends_1d' | null {
  const left = (endsAt.getTime() - now.getTime()) / DAY;
  if (left <= 0) return null;
  if (left <= 1) return 'trial_ends_1d';
  if (left <= 3) return 'trial_ends_3d';
  return null;
}

async function claim(organizationId: string, kind: ReminderKind): Promise<string | null> {
  try {
    return (await prisma.onboardingEmail.create({ data: { organizationId, kind }, select: { id: true } })).id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  }
}

async function ownersOf(ids: string[]) {
  const rows = await prisma.membership.findMany({
    where: { organizationId: { in: ids }, status: 'ACTIVE', role: { isSystem: true, name: SYSTEM_ROLES.OWNER.name } },
    select: { organizationId: true, user: { select: { email: true } } },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.organizationId, [...(map.get(r.organizationId) ?? []), r.user.email]);
  return map;
}

export async function runOnboardingReminders(
  options: { now?: Date; /** limit to these workspaces — for tests */ only?: string[] } = {},
): Promise<{ sent: Record<ReminderKind, number>; failed: number }> {
  const now = options.now ?? new Date();
  const sent: Record<ReminderKind, number> = { setup_day_3: 0, setup_day_7: 0, trial_ends_3d: 0, trial_ends_1d: 0 };
  let failed = 0;

  const trials = await prisma.subscription.findMany({
    where: {
      status: 'TRIALING',
      lapsedAt: null,
      organization: { status: 'ACTIVE' },
      ...(options.only ? { organizationId: { in: options.only } } : {}),
      OR: [
        { trialEndsAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY) } },
        { organization: { createdAt: { gte: new Date(now.getTime() - 14 * DAY), lte: new Date(now.getTime() - 3 * DAY) } } },
      ],
    },
    select: {
      trialEndsAt: true,
      plan: { select: { name: true } },
      organization: {
        select: { id: true, name: true, slug: true, createdAt: true, onboardingEmails: { select: { kind: true } } },
      },
    },
    take: 500,
  });
  if (trials.length === 0) return { sent, failed };

  const ids = trials.map((t) => t.organization.id);
  const [progress, owners, { graceDays }] = await Promise.all([setupProgressFor(ids), ownersOf(ids), getBillingSettings()]);

  for (const t of trials) {
    const org = t.organization;
    const to = owners.get(org.id) ?? [];
    if (to.length === 0) continue;
    const already = new Set(org.onboardingEmails.map((e) => e.kind));
    const adminUrl = getAdminUrl(org.slug, '/dashboard');

    const due: { kind: ReminderKind; email: Parameters<typeof sendPlatformNoticeEmail>[0] }[] = [];

    const setupKind = setupReminderDue(org.createdAt, now);
    const p = progress.get(org.id);
    if (setupKind && p && !p.isOpen && !already.has(setupKind)) {
      const stepsLeft = p.steps.filter((s) => !s.done && !s.optional).map((s) => s.title);
      due.push({
        kind: setupKind,
        email: { to, ...setupReminderEmail({ shopName: org.name, stepsLeft, adminUrl, day: setupKind === 'setup_day_3' ? 3 : 7 }) },
      });
    }

    const trialKind = t.trialEndsAt ? trialReminderDue(t.trialEndsAt, now) : null;
    if (trialKind && t.trialEndsAt && !already.has(trialKind) && !(trialKind === 'trial_ends_3d' && already.has('trial_ends_1d'))) {
      due.push({
        kind: trialKind,
        email: {
          to,
          ...trialEndingEmail({
            shopName: org.name,
            planName: t.plan?.name ?? 'your plan',
            endsAt: t.trialEndsAt,
            graceDays,
            upgradeUrl: getAdminUrl(org.slug, '/upgrade'),
            daysLeft: Math.max(1, Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / DAY)),
          }),
        },
      });
    }

    for (const { kind, email } of due) {
      const claimId = await claim(org.id, kind);
      if (!claimId) continue;
      if (await sendPlatformNoticeEmail(email)) {
        sent[kind] += 1;
      } else {
        failed += 1;
        await prisma.onboardingEmail.delete({ where: { id: claimId } }).catch(() => {});
      }
    }
  }
  return { sent, failed };
}
