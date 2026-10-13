/*
 * /notifications — everything this member has been told about in this shop
 * (ROADMAP 18.2), newest first; the bell in the header shows the latest few.
 *
 * The filter (`show=unread`) and the page number live in the URL (AGENTS §3)
 * and become the query; nothing is filtered in the browser. Every member has
 * a list of their own, so no permission is needed to read it.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { listNotifications } from '@/lib/notifications/inbox';
import { NOTIFICATION_RETENTION_DAYS } from '@/lib/data-rights/policy';
import { NotificationList } from '@/components/notifications/notification-list';

export const metadata: Metadata = { title: 'Notifications' };

type Props = { searchParams: Promise<{ show?: string; page?: string }> };

export default async function NotificationsPage({ searchParams }: Props) {
  const ctx = await getOrganizationContext();
  const params = await searchParams;
  const unreadOnly = params.show === 'unread';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  const data = await listNotifications({ kind: 'staff', userId: ctx.userId, organizationId: ctx.organization.id }, { unreadOnly, page });
  if (data.items.length === 0 && page > 1) redirect(unreadOnly ? '/notifications?show=unread' : '/notifications');

  return (
    <NotificationList
      data={data}
      base="/notifications"
      settingsHref="/settings/notifications"
      unreadOnly={unreadOnly}
      description={`What needs your attention in ${ctx.organization.name}, newest first. Kept for ${NOTIFICATION_RETENTION_DAYS} days.`}
    />
  );
}
