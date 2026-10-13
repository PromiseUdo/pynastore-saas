/*
 * Settings → Notifications (ROADMAP 18.3, 18.6) — this member's own: what
 * reaches them by email and as device alerts, alerts on this browser, and
 * the other browsers that get them for this shop. Every member has one, so
 * no permission is needed.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { PLATFORM_NAME } from '@/lib/brand';
import { listBrowsers } from '@/lib/notifications/web-push-subscriptions';
import { loadPreferenceGrid } from '@/lib/notifications/preference-grid';
import { PreferenceGrid } from '@/components/notifications/preference-grid';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { DeviceAlerts } from '@/components/notifications/device-alerts';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationSettingsPage() {
  const ctx = await getOrganizationContext();
  const [devices, rows] = await Promise.all([
    listBrowsers({ audience: 'STAFF', organizationId: ctx.organization.id, userId: ctx.userId }),
    loadPreferenceGrid({ audience: 'staff', userId: ctx.userId, organizationId: ctx.organization.id, permissions: ctx.membership.role.permissions }),
  ]);

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={`How you hear about what needs you in ${ctx.organization.name}. These are yours; each member chooses their own.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/notifications">
              <Bell aria-hidden />
              See notifications
            </Link>
          </Button>
        }
      />
      <PageBody className="max-w-3xl space-y-6">
        <PreferenceGrid rows={rows} scope="staff" />
        <DeviceAlerts route="/notifications/web-push" devices={devices} appName={PLATFORM_NAME} />
      </PageBody>
    </div>
  );
}
