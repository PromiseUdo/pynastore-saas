/*
 * lib/notifications/digest.ts
 *
 * The daily summary email (ROADMAP 18.6). Some kinds are worth knowing about
 * but not worth an email each — a product running low, a shopper's question
 * — so their email channel is `digest` (./events.ts): they land in the list
 * at once, and once a day each member gets ONE email per shop listing what
 * they haven't seen yet. Run by the "notification-digests" job.
 *
 *   - only what's still unread, from the last two days (a missed run is
 *     caught up, nothing older is dug up);
 *   - only categories the member still wants by email (preferences);
 *   - only for a shop they're still an active member of;
 *   - each notification is emailed at most once (`emailedAt`), and only
 *     marked once the email was accepted, so a failure is tried again
 *     tomorrow.
 *
 * Server only; never throws.
 */
import { prisma } from '@/lib/prisma';
import { getAdminUrl } from '@/lib/tenant/urls';
import { PLATFORM_NAME } from '@/lib/brand';
import { EVENTS, NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationKind } from './events';
import { loadChoices, personKey, wants } from './preferences';
import { sendEmailMessage } from './channels/email';
import type { Person } from './recipients';

export const DIGEST_KINDS = (Object.keys(EVENTS) as NotificationKind[]).filter((kind) => EVENTS[kind].channels.EMAIL === 'digest');

/** How far back a summary looks — a day, plus a day's grace for a missed run. */
const LOOK_BACK_MS = 48 * 3_600_000;
/** How many lines one email lists before "and N more". */
const MAX_LINES = 20;

const categoryOf = (kind: string) => EVENTS[kind as NotificationKind].category;

export async function sendDailyDigests(options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const result = { emails: 0, notifications: 0, failed: 0 };
  try {
    const rows = await prisma.notification.findMany({
      where: {
        kind: { in: DIGEST_KINDS },
        emailedAt: null,
        readAt: null,
        createdAt: { gte: new Date(now.getTime() - LOOK_BACK_MS), lte: now },
        userId: { not: null },
        organizationId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        userId: true,
        organizationId: true,
        user: { select: { email: true } },
        organization: { select: { name: true, slug: true, status: true } },
      },
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.userId}|${row.organizationId}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    for (const items of groups.values()) {
      const { userId, organizationId, user, organization } = items[0];
      const ids = items.map((i) => i.id);
      const member = await prisma.membership.findFirst({
        where: { userId: userId!, organizationId: organizationId!, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!member || organization?.status !== 'ACTIVE' || !user?.email) continue;

      const person: Person = {
        userId,
        customerId: null,
        scope: organizationId!,
        organizationId,
        email: user.email,
        surface: 'admin',
        devices: [],
        browsers: [],
      };
      const choices = new Map<NotificationCategory, boolean>();
      for (const category of new Set(items.map((i) => categoryOf(i.kind)))) {
        const stored = (await loadChoices([person], category)).get(personKey(person))?.EMAIL;
        choices.set(category, wants('digest', stored));
      }
      const wanted = items.filter((i) => choices.get(categoryOf(i.kind)));
      if (wanted.length === 0) {
        // Turned off: nothing to send, and nothing to look at again tomorrow.
        await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { emailedAt: now } });
        continue;
      }

      const sections = [...new Set(wanted.map((i) => categoryOf(i.kind)))].map((c) => NOTIFICATION_CATEGORIES[c].label.toLowerCase());
      const lines = wanted.slice(0, MAX_LINES).map((i) => `${i.title} — ${i.body}`);
      if (wanted.length > MAX_LINES) lines.push(`…and ${wanted.length - MAX_LINES} more`);

      const sent = await sendEmailMessage(
        {
          template: 'platform-notice',
          props: {
            subject: `${organization.name}: ${wanted.length} new ${wanted.length === 1 ? 'notification' : 'notifications'}`,
            preview: lines[0],
            heading: `Your day at ${organization.name}`,
            paragraphs: [`What came in about ${sections.join(' and ')} since your last summary that you haven’t looked at yet:`],
            list: lines,
            button: { label: 'Open notifications', url: getAdminUrl(organization.slug, '/notifications') },
            footer: `One summary a day from ${PLATFORM_NAME}. Choose what you get in Settings → Notifications.`,
          },
        },
        [user.email],
      );
      if (!sent) {
        result.failed += 1;
        continue;
      }
      await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { emailedAt: now } });
      result.emails += 1;
      result.notifications += wanted.length;
    }
  } catch (error) {
    console.error('[notifications] The daily summary failed:', error);
    result.failed += 1;
  }
  return result;
}
