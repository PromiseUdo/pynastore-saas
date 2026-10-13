/*
 * Platform console → Notifications (ROADMAP 18.2): everything this staff
 * member has been told about — broken jobs and webhooks, error spikes,
 * domain and app orders, payment disputes — newest first. The filter and
 * the page number live in the URL.
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPlatformStaff } from '@/lib/platform-staff';
import { listNotifications } from '@/lib/notifications/inbox';
import { NOTIFICATION_RETENTION_DAYS } from '@/lib/data-rights/policy';
import { NotificationList } from '@/components/notifications/notification-list';

export const metadata: Metadata = { title: 'Notifications' };

type Props = { searchParams: Promise<{ show?: string; page?: string }> };

export default async function PlatformNotificationsPage({ searchParams }: Props) {
  // The layout's staff check runs alongside this page, not before it.
  const staff = await getPlatformStaff();
  if (!staff) notFound();
  const params = await searchParams;
  const unreadOnly = params.show === 'unread';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  const data = await listNotifications({ kind: 'platform', userId: staff.userId }, { unreadOnly, page });
  if (data.items.length === 0 && page > 1) redirect(unreadOnly ? '/platform/notifications?show=unread' : '/platform/notifications');

  return (
    <NotificationList
      data={data}
      base="/platform/notifications"
      settingsHref="/platform/settings/notifications"
      unreadOnly={unreadOnly}
      description={`What needs platform staff, newest first. Kept for ${NOTIFICATION_RETENTION_DAYS} days.`}
    />
  );
}
