/*
 * lib/business-app/push.ts
 *
 * Phone notifications for staff, in the business app (ROADMAP 19.4). Server
 * only. A phone here belongs to the signed-in PERSON, not to a shop
 * (`PushDevice.organizationId` is null): it hears about every shop they're
 * in, as each shop's preferences allow (lib/notifications/recipients.ts).
 *
 * Decided from the request: the person from the session, the app and the
 * phone from the user agent. A token only ever moves to whoever registers it
 * now — the same phone signed in as someone else becomes theirs.
 */
import { prisma } from '@/lib/prisma';
import { BUSINESS_APP_ID, isBusinessAppUserAgent, pushPlatformFromUserAgent, userAgentHasPush } from '@/lib/mobile/app-config';
import { fcmConfigured } from '@/lib/mobile/push/fcm';
import { isPlausiblePushToken } from '@/lib/mobile/push/messages';
import { businessApnsCredentials } from '@/lib/mobile/push/send';

/** Whether to offer phone notifications on this request: the business app, built with push, that we can reach. */
export function businessPushReady(userAgent: string | null | undefined): boolean {
  if (!isBusinessAppUserAgent(userAgent) || !userAgentHasPush(userAgent)) return false;
  const platform = pushPlatformFromUserAgent(userAgent);
  if (platform === 'ANDROID') return fcmConfigured();
  if (platform === 'IOS') return businessApnsCredentials() !== null;
  return false;
}

/** Record this phone for this person. Null when the token isn't one the platform would issue. */
export async function linkBusinessPhone(input: { userId: string; deviceToken: string; userAgent: string | null | undefined }) {
  const platform = pushPlatformFromUserAgent(input.userAgent);
  const token = input.deviceToken.trim();
  if (!platform || !isPlausiblePushToken(platform, token)) return null;
  const owner = { userId: input.userId, platform, organizationId: null, customerId: null };
  return prisma.pushDevice.upsert({
    where: { appId_token: { appId: BUSINESS_APP_ID, token } },
    create: { ...owner, appId: BUSINESS_APP_ID, token },
    update: { ...owner, lastSeenAt: new Date() },
    select: { id: true },
  });
}

/** Stop this phone, if it's this person's. */
export async function unlinkBusinessPhone(input: { userId: string; deviceToken: string }): Promise<boolean> {
  const removed = await prisma.pushDevice.deleteMany({ where: { appId: BUSINESS_APP_ID, token: input.deviceToken.trim(), userId: input.userId } });
  return removed.count > 0;
}
