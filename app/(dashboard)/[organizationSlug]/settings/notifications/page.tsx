/*
 * Settings → Notifications (ROADMAP 18.3) — this member's own: alerts on
 * this browser, and the other browsers that get them for this shop. Every
 * member has one, so no permission is needed.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { PLATFORM_NAME } from '@/lib/brand';
import { listBrowsers } from '@/lib/notifications/web-push-subscriptions';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { DeviceAlerts } from '@/components/notifications/device-alerts';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationSettingsPage() {
  const ctx = await getOrganizationContext();
  const devices = await listBrowsers({ audience: 'STAFF', organizationId: ctx.organization.id, userId: ctx.userId });

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
      <PageBody className="max-w-3xl">
        <DeviceAlerts route="/notifications/web-push" devices={devices} appName={PLATFORM_NAME} />
      </PageBody>
    </div>
  );
}
