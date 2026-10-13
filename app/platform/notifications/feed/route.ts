/*
 * POST /platform/notifications/feed — the console's bell (ROADMAP 18.2): a
 * platform staff member's unread count, the newest few, and marking them
 * read. Anyone else gets a plain 404, like the console's pages. What it
 * answers is in lib/notifications/routes.ts.
 */
import { getPlatformStaff } from '@/lib/platform-staff';
import { bellFeedResponse } from '@/lib/notifications/routes';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const staff = await getPlatformStaff();
  if (!staff) return new Response(null, { status: 404 });
  return bellFeedResponse(request, { kind: 'platform', userId: staff.userId });
}
