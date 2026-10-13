/*
 * lib/data-rights/retention.ts
 *
 * The daily data-retention job (ROADMAP 13.8, scheduled as
 * "data-retention" in lib/cron/jobs.ts). It carries out policy.ts:
 *
 *   1. closed workspaces past the grace period → purgeClosedWorkspace;
 *   2. closed workspaces past the retention period → erased entirely;
 *   3. deleted shoppers' orders past the retention period → the contact and
 *      delivery details on them are erased;
 *   4. deleted shoppers with nothing left inside the retention period → the
 *      name on the customer record goes too;
 *   5. guest chats nobody has written in for a year → removed (17.5);
 *   6. phones' and browsers' order watches past 60 days → ended (16.4, 18.3);
 *   7. notifications past 90 days, with what was sent for them → removed (18.1);
 *   8. spent one-minute sign-in tickets (shoppers' and the business app's,
 *      16.1 and 19.2) → removed an hour after they expired.
 *
 * A running shop's own customers and guest orders are the merchant's records
 * and are never touched here. Each workspace is handled on its own, so one
 * failure (Cloudinary down, say) is recorded and retried tomorrow without
 * holding up the rest.
 */
import { purgeExpiredAppTickets } from '@/lib/business-app/tickets';
import { purgeOldPushWatches } from '@/lib/mobile/push/watch';
import { purgeExpiredHandoffs } from '@/lib/storefront/account/handoff';
import { purgeOldBrowserWatches } from '@/lib/notifications/web-push-subscriptions';
import { prisma } from '@/lib/prisma';
import { reportCaughtError } from '@/lib/ops/errors';
import { CLOSURE_GRACE_DAYS, guestChatCutoff, notificationCutoff, retentionCutoff } from './policy';
import { eraseOrganization } from './erase';
import { purgeClosedWorkspace } from './workspace';

export interface RetentionResult {
  workspacesPurged: number;
  filesDeleted: number;
  workspacesErased: number;
  ordersAnonymized: number;
  customersAnonymized: number;
  /** order notifications past their 60 days (ROADMAP 16.4) */
  pushWatchesRemoved: number;
  /** guest chats with no message for GUEST_CHAT_RETENTION_MONTHS (ROADMAP 17.5) */
  guestChatsRemoved: number;
  /** notification list entries past NOTIFICATION_RETENTION_DAYS (ROADMAP 18.1) */
  notificationsRemoved: number;
  failed: number;
}

const ANONYMIZED_CUSTOMER = 'Deleted customer';

export async function runDataRetention(options: { now?: Date; only?: string[] } = {}): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const scope = options.only ? { id: { in: options.only } } : {};
  const orgScope = options.only ? { organizationId: { in: options.only } } : {};
  const cutoff = retentionCutoff(now);
  const result: RetentionResult = { workspacesPurged: 0, filesDeleted: 0, workspacesErased: 0, ordersAnonymized: 0, customersAnonymized: 0, pushWatchesRemoved: 0, guestChatsRemoved: 0, notificationsRemoved: 0, failed: 0 };

  // 1. Past the grace period: keep only the business records.
  const toPurge = await prisma.organization.findMany({
    where: { ...scope, status: 'DELETED', closedDataPurgedAt: null, closedAt: { lte: new Date(now.getTime() - CLOSURE_GRACE_DAYS * 86_400_000) } },
    select: { id: true, name: true },
    take: 20,
  });
  for (const org of toPurge) {
    try {
      const { purged, files } = await purgeClosedWorkspace(org.id, now);
      if (purged) result.workspacesPurged += 1;
      result.filesDeleted += files;
    } catch (error) {
      result.failed += 1;
      await reportCaughtError(error, 'data-retention:purge', { message: `Couldn’t purge closed workspace ${org.name}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // 2. Past the retention period: nothing is kept.
  const toErase = await prisma.organization.findMany({
    where: { ...scope, status: 'DELETED', closedAt: { lte: cutoff } },
    select: { id: true, name: true },
    take: 5,
  });
  for (const org of toErase) {
    try {
      await prisma.$transaction((tx) => eraseOrganization(tx, org.id), { timeout: 300_000 });
      result.workspacesErased += 1;
    } catch (error) {
      result.failed += 1;
      await reportCaughtError(error, 'data-retention:erase', { message: `Couldn’t erase workspace ${org.name}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // 3. Deleted shoppers' orders, once the law no longer needs them.
  const orders = await prisma.order.updateMany({
    where: { ...orgScope, anonymizedAt: null, placedAt: { lte: cutoff }, customer: { accountDeletedAt: { not: null } } },
    data: {
      email: null,
      firstName: null,
      lastName: null,
      phone: null,
      shipFullName: null,
      shipPhone: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipState: null,
      shipPostalCode: null,
      note: null,
      anonymizedAt: now,
    },
  });
  result.ordersAnonymized = orders.count;

  // 4. …and the name itself, once nothing within the period still needs it.
  const recent = { gt: cutoff };
  const customers = await prisma.customer.updateMany({
    where: {
      ...orgScope,
      accountDeletedAt: { not: null },
      anonymizedAt: null,
      orders: { none: { placedAt: recent } },
      invoices: { none: { createdAt: recent } },
      quotes: { none: { createdAt: recent } },
      dropShipPurchaseOrders: { none: { createdAt: recent } },
    },
    data: { name: ANONYMIZED_CUSTOMER, taxId: null, anonymizedAt: now },
  });
  result.customersAnonymized = customers.count;

  // 5. A guest's chat ends a year after anyone last wrote in it (ROADMAP 17.5).
  //    Messages cascade. A signed-in shopper's chat isn't touched here.
  const guestChats = await prisma.chatConversation.deleteMany({
    where: { ...orgScope, customerId: null, lastMessageAt: { lte: guestChatCutoff(now) } },
  });
  result.guestChatsRemoved = guestChats.count;

  // 6. Phones stop hearing about an order 60 days after asking (ROADMAP 16.4).
  if (!options.only) {
    const push = await purgeOldPushWatches(now);
    const browsers = await purgeOldBrowserWatches(now);
    result.pushWatchesRemoved = push.watches + browsers.watches;
  }

  // 7. Notifications keep 90 days; the event takes its outbox rows with it.
  //    Platform-wide ones (no shop) only on a full run.
  const old = { createdAt: { lte: notificationCutoff(now) } };
  const notifications = await prisma.notification.deleteMany({
    where: { ...old, ...(options.only ? { organizationId: { in: options.only } } : {}) },
  });
  await prisma.notificationEvent.deleteMany({ where: { ...old, ...(options.only ? { organizationId: { in: options.only } } : {}) } });
  result.notificationsRemoved = notifications.count;

  // 8. Tickets are worthless after their minute; only their ids are kept.
  if (!options.only) await Promise.all([purgeExpiredHandoffs(), purgeExpiredAppTickets()]);

  return result;
}
