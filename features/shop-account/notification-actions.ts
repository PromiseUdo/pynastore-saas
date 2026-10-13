'use server';

/*
 * features/shop-account/notification-actions.ts
 *
 * A signed-in shopper reading their notifications (ROADMAP 18.2). The list is
 * always the session's own shopper in this store (getShopper pins both); a
 * notification id from the browser is only ever used together with them, so
 * another shopper's id changes nothing. A guest reaches none of this.
 */
import { getShopper } from '@/lib/storefront/account/session';
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
