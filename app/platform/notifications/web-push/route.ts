/*
 * /platform/notifications/web-push — alerts on this browser, for platform
 * staff (ROADMAP 18.3). POST subscribes, DELETE stops; anyone else gets a
 * plain 404, like the console's pages.
 */
import { getPlatformStaff } from '@/lib/platform-staff';
import { subscribeBrowser, unsubscribeBrowser } from '@/lib/notifications/web-push-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const staff = await getPlatformStaff();
  if (!staff) return new Response(null, { status: 404 });
  return subscribeBrowser(request, { audience: 'PLATFORM', organizationId: null, userId: staff.userId });
}

export async function DELETE(request: Request) {
  const staff = await getPlatformStaff();
  if (!staff) return new Response(null, { status: 404 });
  return unsubscribeBrowser(request, { audience: 'PLATFORM', organizationId: null, userId: staff.userId });
}
