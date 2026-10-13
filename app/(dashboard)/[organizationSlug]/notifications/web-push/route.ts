/*
 * /notifications/web-push — alerts on this browser, for a member of this shop
 * (ROADMAP 18.3). POST subscribes, DELETE stops. The shop comes from the
 * hostname (the proxy), the member from the session; what it answers is in
 * lib/notifications/web-push-route.ts.
 */
import { getOrganizationContext } from '@/lib/organization';
import { subscribeBrowser, unsubscribeBrowser } from '@/lib/notifications/web-push-route';
import type { BrowserOwner } from '@/lib/notifications/web-push-subscriptions';

export const dynamic = 'force-dynamic';

async function owner(): Promise<BrowserOwner> {
  const ctx = await getOrganizationContext();
  return { audience: 'STAFF', organizationId: ctx.organization.id, userId: ctx.userId };
}

export async function POST(request: Request) {
  return subscribeBrowser(request, await owner());
}

export async function DELETE(request: Request) {
  return unsubscribeBrowser(request, await owner());
}
