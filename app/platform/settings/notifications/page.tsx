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
import { loadPreferenceGrid } from '@/lib/notifications/preference-grid';
import { PreferenceGrid } from '@/components/notifications/preference-grid';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { DeviceAlerts } from '@/components/notifications/device-alerts';

export const metadata: Metadata = { title: 'Notification settings' };

export default async function PlatformNotificationSettingsPage() {
  const staff = await getPlatformStaff();
  if (!staff) notFound();
  const [devices, rows] = await Promise.all([
    listBrowsers({ audience: 'PLATFORM', organizationId: null, userId: staff.userId }),
    loadPreferenceGrid({ audience: 'platform', userId: staff.userId }),
  ]);

  return (
    <div>
      <PageHeader
        title="Notification settings"
        description="How you hear about broken jobs and webhooks, error spikes, disputes, new shops, and domain and app orders. Email for these goes to the platform’s alert address."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/platform/notifications">
              <Bell aria-hidden />
              See notifications
            </Link>
          </Button>
        }
      />
      <PageBody className="max-w-3xl space-y-6">
        <PreferenceGrid rows={rows} scope="platform" />
        <DeviceAlerts route="/platform/notifications/web-push" devices={devices} appName={`${PLATFORM_NAME} console`} />
      </PageBody>
    </div>
  );
}
