/*
 * lib/notifications/inbox.ts
 *
 * Reading and clearing a person's notification list (ROADMAP 18.2). Server
 * only.
 *
 * Every function takes a READER (./readers.ts), built by the caller from
 * the session — never from the browser. A notification id from the browser is only ever used together with the
 * reader (`where: { id, ...whose(reader) }`), so someone else's id is a miss.
 * Links come from lib/notifications/links.ts at read time, never from the row.
 */
import { prisma } from '@/lib/prisma';
import { pathFor, type NotificationTarget, type Surface } from './links';
import { announceListChanged } from './realtime';
import { syncAppBadges } from './badges';
import { runAfter } from '@/lib/run-after';
import { unreadCount, whose, type Reader } from './readers';
import type { NotificationItem, NotificationPage } from './view';

export type { Reader } from './readers';
export { unreadCount } from './readers';

/** The bell's dropdown. */
export const BELL_SIZE = 8;
export const PAGE_SIZE = 20;

const SURFACE: Record<Reader['kind'], Surface> = { staff: 'admin', platform: 'platform', shopper: 'store' };

const TARGET_TYPES = new Set<NotificationTarget['type']>([
  'order',
  'return',
  'conversation',
  'dispute',
  'low-stock',
  'purchase-order',
  'social-post',
  'questions',
  'admin-page',
  'platform',
]);

/** Where an entry leads for this reader. A signed-in shopper goes to their account's page, not the emailed link. */
function hrefFor(target: unknown, reader: Reader): string | null {
  if (!target || typeof target !== 'object' || !TARGET_TYPES.has((target as NotificationTarget).type)) return null;
  const typed = target as NotificationTarget;
  const own = reader.kind === 'shopper' && 'confirmationToken' in typed ? { ...typed, confirmationToken: null } : typed;
  return pathFor(own, SURFACE[reader.kind]);
}

const SELECT = { id: true, title: true, body: true, target: true, createdAt: true, readAt: true } as const;

function toItem(row: { id: string; title: string; body: string; target: unknown; createdAt: Date; readAt: Date | null }, reader: Reader): NotificationItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    href: hrefFor(row.target, reader),
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
  };
}

/** The newest few, for the bell. */
export async function latestNotifications(reader: Reader, take = BELL_SIZE): Promise<{ unread: number; items: NotificationItem[] }> {
  const [unread, rows] = await Promise.all([
    unreadCount(reader),
    prisma.notification.findMany({ where: whose(reader), orderBy: { createdAt: 'desc' }, take, select: SELECT }),
  ]);
  return { unread, items: rows.map((row) => toItem(row, reader)) };
}

/** One page of the full list, newest first; `unreadOnly` is the "Unread" filter. */
export async function listNotifications(reader: Reader, options: { unreadOnly?: boolean; page?: number } = {}): Promise<NotificationPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const where = { ...whose(reader), ...(options.unreadOnly ? { readAt: null } : {}) };
  const [total, unread, any, rows] = await Promise.all([
    prisma.notification.count({ where }),
    unreadCount(reader),
    prisma.notification.count({ where: whose(reader), take: 1 }),
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: SELECT }),
  ]);
  return { items: rows.map((row) => toItem(row, reader)), total, page, pageSize: PAGE_SIZE, unread, any: any > 0 };
}

/** After a change to what's unread: open bells hear it, and a shopper's iPhone icons are corrected — after the response. */
async function unreadChanged(reader: Reader): Promise<void> {
  await announceListChanged([reader]);
  runAfter(() => syncAppBadges(reader));
}

/** Mark one read (opening it does this). Someone else's id, or one already read, changes nothing. */
export async function markNotificationRead(reader: Reader, id: string): Promise<boolean> {
  const marked = await prisma.notification.updateMany({ where: { id, ...whose(reader), readAt: null }, data: { readAt: new Date() } });
  if (marked.count > 0) await unreadChanged(reader);
  return marked.count > 0;
}

export async function markAllNotificationsRead(reader: Reader): Promise<number> {
  const marked = await prisma.notification.updateMany({ where: { ...whose(reader), readAt: null }, data: { readAt: new Date() } });
  if (marked.count > 0) await unreadChanged(reader);
  return marked.count;
}

/**
 * Everything about one thing ("order:{id}", "chat:{id}") marked read — when
 * the person opens that thing itself, not the notification: the chat, or the
 * order's page. Never throws.
 */
export async function markThreadRead(reader: Reader, threadKey: string): Promise<void> {
  try {
    const marked = await prisma.notification.updateMany({ where: { ...whose(reader), threadKey, readAt: null }, data: { readAt: new Date() } });
    if (marked.count > 0) await unreadChanged(reader);
  } catch (error) {
    console.error('[notifications] Couldn’t mark a thread read:', error);
  }
}
