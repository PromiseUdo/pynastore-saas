/*
 * lib/chat/push.ts
 *
 * "Get a notification when the store replies", from the chat inside a
 * store's own app (ROADMAP 17.4) — the chat's version of watchOrder in
 * lib/mobile/push/watch.ts, and decided the same way: the store from the
 * request, the app and phone from the user agent, the conversation from who
 * the shopper is. A phone is only ever linked to its own shopper's
 * conversation, and only after they asked (or had already allowed
 * notifications for the app).
 */
import { prisma } from '@/lib/prisma';
import { appIdFromUserAgent, pushPlatformFromUserAgent } from '@/lib/mobile/app-config';
import { isPlausiblePushToken } from '@/lib/mobile/push/messages';
import { pushReadyFor } from '@/lib/mobile/push/watch';
import type { ChatIdentity } from './identity';

export type ChatWatchResult = 'watching' | 'unavailable' | 'not-found' | 'invalid-token';

export async function watchChatReplies(input: {
  store: { slug: string; organizationId: string };
  identity: ChatIdentity | null;
  deviceToken: string;
  userAgent: string | null | undefined;
}): Promise<ChatWatchResult> {
  if (!(await pushReadyFor(input.userAgent, input.store.slug))) return 'unavailable';
  const platform = pushPlatformFromUserAgent(input.userAgent)!;
  const appId = appIdFromUserAgent(input.userAgent)!;

  const deviceToken = input.deviceToken.trim();
  if (!isPlausiblePushToken(platform, deviceToken)) return 'invalid-token';
  if (!input.identity) return 'not-found';

  const { organizationId } = input.store;
  const conversation = await prisma.chatConversation.findUnique({
    where:
      input.identity.kind === 'customer'
        ? { organizationId_customerId: { organizationId, customerId: input.identity.customerId } }
        : { organizationId_guestKeyHash: { organizationId, guestKeyHash: input.identity.guestKeyHash } },
    select: { id: true },
  });
  if (!conversation) return 'not-found';

  const device = await prisma.pushDevice.upsert({
    where: { appId_token: { appId, token: deviceToken } },
    create: { organizationId, appId, platform, token: deviceToken },
    update: { organizationId, platform, lastSeenAt: new Date() },
    select: { id: true },
  });
  await prisma.pushChatWatch.upsert({
    where: { deviceId_conversationId: { deviceId: device.id, conversationId: conversation.id } },
    create: { deviceId: device.id, conversationId: conversation.id },
    update: {},
  });
  return 'watching';
}
