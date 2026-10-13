/*
 * lib/notifications/view.ts
 *
 * What a notification list looks like on screen (ROADMAP 18.2). Safe in the
 * browser: types and one guard, nothing that reaches the database.
 */

/** One entry in someone's list, ready to show. */
export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  /** the page it leads to on this host, or null when it has none */
  href: string | null;
  createdAt: string;
  read: boolean;
}

/** One page of the full list. */
export interface NotificationPage {
  items: NotificationItem[];
  /** how many match the filter */
  total: number;
  page: number;
  pageSize: number;
  unread: number;
  /** whether this person has any notifications at all, filters aside */
  any: boolean;
}

/** What the bell's feed answers. */
export interface BellFeed {
  unread: number;
  items?: NotificationItem[];
}

/** One of a person's browsers that gets notifications (ROADMAP 18.3). */
export interface BrowserView {
  id: string;
  /** "Chrome on Android" */
  label: string;
  /** lets the page say which one is "this browser"; it's the person's own */
  endpoint: string;
  createdAt: string;
}

/** What a person's live channel carries: their unread count, nothing else. */
export interface ListEvent {
  unread: number;
}

export function isListEvent(data: unknown): data is ListEvent {
  return Boolean(data) && typeof data === 'object' && typeof (data as { unread?: unknown }).unread === 'number';
}

/** "9+" past nine, so the badge stays one small circle. */
export function unreadBadge(count: number): string {
  return count > 9 ? '9+' : String(count);
}
