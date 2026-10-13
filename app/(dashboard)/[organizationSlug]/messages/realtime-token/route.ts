/*
 * POST /messages/realtime-token — a listen-only Ably token for this store's
 * inbox (Messages, real-time), for the member's Messages page.
 *
 * Inside the dashboard segment, like ../feed, so the store comes from the
 * hostname through the proxy and getOrganizationContext() — never from the
 * browser. Needs `messages.view`, and a workspace whose plan hasn't ended.
 * The token can only `subscribe`, to exactly inbox:{organizationId}. Each
 * renewal comes back here, so a member removed or demoted stops being renewed
 * within the token's hour. JSON only, so another site can't fetch one.
 */
import { getOrganizationContext } from '@/lib/organization';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { inboxChannelName } from '@/lib/chat/ably';
import { ablyConfigured, listenTokenRequest } from '@/lib/realtime/ably';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
  if (!ablyConfigured()) return json({ error: 'Real-time updates are off.' }, 503);

  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.MESSAGES_VIEW)) {
    return json({ error: 'You don’t have permission to see messages.' }, 403);
  }
  if ((await getOrganizationEntitlements()).access.state === 'lapsed') return json({ error: 'Your plan has ended.' }, 403);

  const channel = inboxChannelName(ctx.organization.id);
  const tokenRequest = await listenTokenRequest([channel]);
  if (!tokenRequest) return json({ error: 'Real-time updates are off.' }, 503);
  return json({ tokenRequest, channel });
}
