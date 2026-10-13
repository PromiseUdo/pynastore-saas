/*
 * POST /platform/notifications/realtime-token — a listen-only Ably token for
 * a platform staff member's own notification list (ROADMAP 18.2). Each
 * renewal comes back here, so someone who stops being staff stops hearing.
 */
import { getPlatformStaff } from '@/lib/platform-staff';
import { bellTokenResponse } from '@/lib/notifications/routes';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const staff = await getPlatformStaff();
  if (!staff) return new Response(null, { status: 404 });
  return bellTokenResponse(request, { kind: 'platform', userId: staff.userId });
}
