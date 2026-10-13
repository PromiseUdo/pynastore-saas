/*
 * POST /notifications/realtime-token — a listen-only Ably token for this
 * member's own notification list in this shop (ROADMAP 18.2). The channel
 * comes from the session (lib/notifications/realtime.ts); each renewal comes
 * back here, so a member removed from the shop stops being renewed.
 */
import { getOrganizationContext } from '@/lib/organization';
import { bellTokenResponse } from '@/lib/notifications/routes';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ctx = await getOrganizationContext();
  return bellTokenResponse(request, { kind: 'staff', userId: ctx.userId, organizationId: ctx.organization.id });
}
