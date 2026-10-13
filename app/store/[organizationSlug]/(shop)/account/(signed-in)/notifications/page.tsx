/*
 * /account/notifications — what this store has told the shopper about
 * (ROADMAP 18.2): their orders' progress and the store's replies in chat,
 * newest first. Guests have no list; they hear by email and on their phone.
 *
 * Twenty to a page, the page number in the URL. Opening an entry marks it
 * read; it leads to the shopper's own order page or the chat.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Bell } from 'lucide-react';
import { getShopper } from '@/lib/storefront/account/session';
import { listNotifications } from '@/lib/notifications/inbox';
import { NOTIFICATION_RETENTION_DAYS } from '@/lib/data-rights/policy';
import { ShopperNotificationList } from '@/components/storefront/account/notification-list';
import { DeviceNotifications } from '@/components/storefront/account/device-notifications';
import { ShopperNotificationPreferences } from '@/components/storefront/account/notification-preferences';
import { loadPreferenceGrid } from '@/lib/notifications/preference-grid';
import { webPushConfigured } from '@/lib/notifications/channels/web-push';
import { prisma } from '@/lib/prisma';
import { headers } from 'next/headers';
import { pushReadyFor } from '@/lib/mobile/push/watch';
import { AccountHeading } from '../../_components/account-heading';

export const metadata: Metadata = { title: 'Notifications' };

type Props = { searchParams: Promise<{ page?: string }> };

export default async function ShopperNotificationsPage({ searchParams }: Props) {
  const shopper = (await getShopper())!;
  const page = Number.parseInt((await searchParams).page ?? '1', 10) || 1;
  const data = await listNotifications({ kind: 'shopper', customerId: shopper.id, organizationId: shopper.organizationId }, { page });
  if (data.items.length === 0 && page > 1) redirect('/account/notifications');

  /* Notifications on this device: this phone inside the store's own app
   * (ROADMAP 18.4), or the browser on the website once the platform has its
   * keys (18.3). */
  const requestHeaders = await headers();
  const store = await prisma.organization.findUnique({ where: { id: shopper.organizationId }, select: { name: true, slug: true } });
  const channel =
    requestHeaders.get('x-runtime') === 'mobile'
      ? store && (await pushReadyFor(requestHeaders.get('user-agent'), store.slug))
        ? ('app' as const)
        : null
      : webPushConfigured()
        ? ('browser' as const)
        : null;
  const device = store && channel ? <DeviceNotifications storeName={store.name} storeSlug={store.slug} channel={channel} /> : null;
  // What reaches them by email and on their devices (ROADMAP 18.6).
  const preferences = (
    <ShopperNotificationPreferences rows={await loadPreferenceGrid({ audience: 'shopper', customerId: shopper.id, organizationId: shopper.organizationId })} />
  );

  if (!data.any) {
    return (
      <>
        <AccountHeading>Notifications</AccountHeading>
        {device}
        <div className="rounded-3xl border border-border bg-card p-8 text-center">
          <Bell className="mx-auto size-7 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 font-display text-lg font-semibold">Nothing yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            When your order moves along or the store replies to you, it shows up here.
          </p>
        </div>
        {preferences}
      </>
    );
  }

  return (
    <>
      <AccountHeading hint={`Updates about your orders and messages. Kept for ${NOTIFICATION_RETENTION_DAYS} days.`}>
        Notifications
      </AccountHeading>
      {device}
      <ShopperNotificationList data={data} />
      {preferences}
    </>
  );
}
