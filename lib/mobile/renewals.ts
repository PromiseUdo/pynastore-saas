/*
 * lib/mobile/renewals.ts
 *
 * The daily store-app job (ROADMAP 16.2), run from
 * app/api/cron/mobile-app-renewals. A store's app is paid a year at a time:
 *
 *   1. reminders to the owners 30, 7 and 1 day(s) before the year ends —
 *      each once per paid-through date (MobileAppReminder);
 *   2. the year ends unpaid → the grace days from Billing settings start,
 *      fixed when recorded, and the owners are told the date;
 *   3. the grace runs out → status LAPSED: the app opens "This app is no
 *      longer available" (16.1) until it's renewed, which switches it straight
 *      back on (lib/mobile/orders.ts, applyMobileAppPayment).
 */
import { prisma } from '@/lib/prisma';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getAdminUrl } from '@/lib/tenant/urls';
import { getMobileAppPricing } from '@/lib/settings';
import { ownerEmails } from '@/lib/org-owners';
import { appGraceEmail, appLapsedEmail, appRenewalReminderEmail } from './emails';

const DAY = 24 * 60 * 60 * 1000;

/** Which reminder is due, from how far away the end of the paid year is. */
export function renewalReminderDue(paidThrough: Date, now: Date): { kind: string; days: number } | null {
  const days = Math.ceil((paidThrough.getTime() - now.getTime()) / DAY);
  if (days <= 0) return null;
  const step = days <= 1 ? 1 : days <= 7 ? 7 : days <= 30 ? 30 : null;
  return step ? { kind: `before_${step}:${paidThrough.toISOString().slice(0, 10)}`, days } : null;
}

export async function runMobileAppRenewals(options: { now?: Date; only?: string[] } = {}) {
  const now = options.now ?? new Date();
  const scope = options.only ? { organizationId: { in: options.only } } : {};
  const result = { reminders: 0, inGrace: 0, lapsed: 0, failed: 0 };
  const pricing = await getMobileAppPricing();

  const apps = await prisma.mobileApp.findMany({
    where: { ...scope, status: 'ACTIVE', stage: { not: 'REQUESTED' }, paidThrough: { not: null } },
    include: { organization: { select: { name: true, slug: true, status: true } } },
  });

  for (const app of apps) {
    if (app.organization.status !== 'ACTIVE') continue;
    const pageUrl = getAdminUrl(app.organization.slug, '/settings/mobile-app');
    const paidThrough = app.paidThrough!;
    const facts = { shopName: app.organization.name, appName: app.name, price: pricing.yearlyFee, pageUrl };

    try {
      // 1. Before the year ends.
      if (paidThrough > now) {
        const due = renewalReminderDue(paidThrough, now);
        if (!due) continue;
        let claimId: string;
        try {
          claimId = (await prisma.mobileAppReminder.create({ data: { mobileAppId: app.id, kind: due.kind }, select: { id: true } })).id;
        } catch {
          continue; // already sent
        }
        const sent = await sendPlatformNoticeEmail({
          to: await ownerEmails(app.organizationId, { includePaymentsContact: true }),
          ...appRenewalReminderEmail({ ...facts, paidThrough, days: due.days }),
        });
        if (sent) result.reminders += 1;
        else {
          result.failed += 1;
          await prisma.mobileAppReminder.delete({ where: { id: claimId } }).catch(() => {});
        }
        continue;
      }

      // 2. The year ended unpaid: the grace period starts, once.
      if (!app.graceEndsAt) {
        const graceEndsAt = new Date(now.getTime() + pricing.graceDays * DAY);
        const claimed = await prisma.mobileApp.updateMany({
          where: { id: app.id, graceEndsAt: null, status: 'ACTIVE' },
          data: { lapsedAt: now, graceEndsAt },
        });
        if (claimed.count !== 1) continue;
        if (pricing.graceDays > 0) {
          result.inGrace += 1;
          await sendPlatformNoticeEmail({
            to: await ownerEmails(app.organizationId, { includePaymentsContact: true }),
            ...appGraceEmail({ ...facts, graceEndsAt }),
          });
          continue;
        }
      } else if (app.graceEndsAt > now) {
        continue;
      }

      // 3. Grace over: the app switches off.
      const lapsed = await prisma.mobileApp.updateMany({ where: { id: app.id, status: 'ACTIVE' }, data: { status: 'LAPSED' } });
      if (lapsed.count !== 1) continue;
      result.lapsed += 1;
      await sendPlatformNoticeEmail({
        to: await ownerEmails(app.organizationId, { includePaymentsContact: true }),
        ...appLapsedEmail(facts),
      });
    } catch (error) {
      result.failed += 1;
      console.error(`[mobile-app renewals] ${app.appId}:`, error);
    }
  }
  return result;
}
