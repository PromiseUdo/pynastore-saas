/*
 * Platform console → notification settings (ROADMAP 18.3) — this staff
 * member's own: alerts on this browser, and their other browsers.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bell } from 'lucide-react';
import { getPlatformStaff } from '@/lib/platform-staff';
import { PLATFORM_NAME } from '@/lib/brand';
import { listBrowsers } from '@/lib/notifications/web-push-subscriptions';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { DeviceAlerts } from '@/components/notifications/device-alerts';

export const metadata: Metadata = { title: 'Notification settings' };

export default async function PlatformNotificationSettingsPage() {
  const staff = await getPlatformStaff();
  if (!staff) notFound();
  const devices = await listBrowsers({ audience: 'PLATFORM', organizationId: null, userId: staff.userId });

  return (
    <div>
      <PageHeader
        title="Notification settings"
        description="How you hear about broken jobs and webhooks, error spikes, disputes, and domain and app orders."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/platform/notifications">
              <Bell aria-hidden />
              See notifications
            </Link>
          </Button>
        }
      />
      <PageBody className="max-w-3xl">
        <DeviceAlerts route="/platform/notifications/web-push" devices={devices} appName={`${PLATFORM_NAME} console`} />
      </PageBody>
    </div>
  );
}
