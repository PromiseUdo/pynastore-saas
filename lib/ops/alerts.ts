/*
 * lib/ops/alerts.ts
 *
 * Emails to platform staff about something broken — a scheduled job, a
 * webhook, an error (ROADMAP 13.1, 13.3) — sent to PLATFORM_ADMIN_EMAIL (a
 * comma-separated list works), at most every ALERT_EVERY_HOURS per subject
 * and kind while it stays broken, and once more when it works again.
 *
 * `subject` names the thing: "cron:<job>", "webhook:<name>", "error:<id>".
 */
import { prisma } from '@/lib/prisma';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { PLATFORM_NAME } from '@/lib/brand';
import { log } from './log';

export const ALERT_EVERY_HOURS = 6;

export type AlertKind = 'failed' | 'overdue' | 'spike' | 'new';

export function staffInbox(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Claim the right to send this alert: the first time, or when the last one
 * went out more than ALERT_EVERY_HOURS ago. Two callers racing can't both win.
 */
export async function claimAlert(subject: string, kind: AlertKind): Promise<boolean> {
  const created = await prisma.opsAlert.createMany({ data: [{ subject, kind }], skipDuplicates: true });
  if (created.count === 1) return true;
  const renewed = await prisma.opsAlert.updateMany({
    where: { subject, kind, sentAt: { lt: new Date(Date.now() - ALERT_EVERY_HOURS * 3_600_000) } },
    data: { sentAt: new Date() },
  });
  return renewed.count === 1;
}

/** Forget every alert about `subject` (optionally only some kinds); how many there were. */
export async function clearAlerts(subject: string, kinds?: AlertKind[]): Promise<number> {
  const cleared = await prisma.opsAlert.deleteMany({ where: { subject, ...(kinds ? { kind: { in: kinds } } : {}) } });
  return cleared.count;
}

export async function sendStaffAlert(input: {
  subject: string;
  heading: string;
  paragraphs: string[];
  button: { label: string; path: string };
}): Promise<void> {
  const to = staffInbox();
  if (to.length === 0) return;
  const sent = await sendPlatformNoticeEmail({
    to,
    subject: input.subject,
    preview: input.heading,
    heading: input.heading,
    paragraphs: input.paragraphs,
    button: { label: input.button.label, url: getMarketingUrl(input.button.path) },
    footer: `Sent by ${PLATFORM_NAME} to platform staff, at most every ${ALERT_EVERY_HOURS} hours while something stays broken.`,
  });
  if (!sent) log.warn('ops.alert.not_sent', { subject: input.subject });
}
