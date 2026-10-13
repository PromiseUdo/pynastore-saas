'use server';

/*
 * features/shop-account/notification-actions.ts
 *
 * A signed-in shopper reading their notifications (ROADMAP 18.2). The list is
 * always the session's own shopper in this store (getShopper pins both); a
 * notification id from the browser is only ever used together with them, so
 * another shopper's id changes nothing. A guest reaches none of this.
 */
import { headers } from 'next/headers';
import { currentStoreSlug, getShopper } from '@/lib/storefront/account/session';
import { setAccountPhone } from '@/lib/mobile/push/watch';
import { savePreference } from '@/lib/notifications/preference-grid';
import { checkRateLimit } from '@/lib/rate-limit';
import { markAllNotificationsRead, markNotificationRead, type Reader } from '@/lib/notifications/inbox';

async function reader(): Promise<Reader | null> {
  const shopper = await getShopper();
  return shopper ? { kind: 'shopper', customerId: shopper.id, organizationId: shopper.organizationId } : null;
}

/** Opening one marks it read. */
export async function openNotificationAction(id: string): Promise<boolean> {
  const who = await reader();
  if (!who || typeof id !== 'string' || id.length > 64) return false;
  return markNotificationRead(who, id);
}

export async function markAllNotificationsReadAction(): Promise<boolean> {
  const who = await reader();
  if (!who) return false;
  await markAllNotificationsRead(who);
  return true;
}

/**
 * "Notifications on this phone" inside the store's own app (ROADMAP 18.4):
 * the phone is linked to — or, turned off, forgotten by — the signed-in
 * shopper's account. The phone and app come from the request's user agent,
 * the store from the page; `deviceToken` is the phone's own push token.
 */
export async function setPhoneNotificationsAction(deviceToken: string, on: boolean): Promise<boolean> {
  const slug = await currentStoreSlug();
  const shopper = await getShopper();
  if (!slug || !shopper || typeof deviceToken !== 'string' || deviceToken.length > 4096) return false;
  if (!(await checkRateLimit(`push-account:${slug}:${shopper.id}`, 20, 10 * 60_000))) return false;
  const result = await setAccountPhone({
    organizationSlug: slug,
    deviceToken,
    userAgent: (await headers()).get('user-agent'),
    customerId: shopper.id,
    on: Boolean(on),
  });
  return result === 'on' || result === 'off';
}

/** A shopper choosing what reaches them by email and on their devices (ROADMAP 18.6). */
export async function setShopperNotificationPreferenceAction(category: string, group: string, enabled: boolean): Promise<boolean> {
  const shopper = await getShopper();
  if (!shopper || (group !== 'email' && group !== 'push')) return false;
  const result = await savePreference(
    { audience: 'shopper', customerId: shopper.id, organizationId: shopper.organizationId },
    String(category),
    group,
    Boolean(enabled),
  ).catch(() => 'failed' as const);
  return result === 'saved';
}
