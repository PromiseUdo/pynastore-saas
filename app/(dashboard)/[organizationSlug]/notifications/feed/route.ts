/*
 * POST /notifications/feed — the bell in the admin header (ROADMAP 18.2):
 * this member's unread count, the newest few, and marking them read.
 *
 * Inside the dashboard segment, like /messages/feed, so the shop comes from
 * the hostname through the proxy and getOrganizationContext() — never from
 * the browser. Every member has a list; no permission is needed to read
 * their own. What it answers is in lib/notifications/routes.ts.
 */
import { getOrganizationContext } from '@/lib/organization';
import { bellFeedResponse } from '@/lib/notifications/routes';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ctx = await getOrganizationContext();
  return bellFeedResponse(request, { kind: 'staff', userId: ctx.userId, organizationId: ctx.organization.id });
}
