/*
 * lib/notifications/links.ts
 *
 * Where a notification leads (ROADMAP 18.5). A notification stores a typed
 * TARGET — what it is about — never a URL; this file is the one place that
 * turns a target into a page, for whoever is looking:
 *
 *   admin     the shop's admin, on its own host ({slug}.)
 *   store     the shop's storefront, for the shopper
 *   platform  the platform console (/platform on the platform host)
 *
 * and, for a store page, the same page inside the shop's app (/s/{slug}/…,
 * the mobile host's shape). Pure apart from reading the configured domains.
 */
import { getAdminUrl, getMarketingUrl } from '@/lib/tenant/urls';
import { storeUrl, type StoreOrigins } from '@/lib/storefront/account/return-url';

export type NotificationTarget =
  /** an order; `confirmationToken` opens its page for a shopper who isn't signed in */
  | { type: 'order'; orderId: string; reference: string; confirmationToken?: string | null }
  | { type: 'return'; returnId: string; orderId: string; reference: string; confirmationToken?: string | null }
  | { type: 'conversation'; conversationId: string }
  /** a chargeback on an order: the order for its shop, the disputes queue for the platform */
  | { type: 'dispute'; orderId: string; reference: string }
  /** what is low in one store */
  | { type: 'low-stock'; warehouseId: string }
  /** a page of the platform console, e.g. /platform/errors/abc */
  | { type: 'platform'; path: string };

export type Surface = 'admin' | 'store' | 'platform';

const orderStorePath = (target: { reference: string; confirmationToken?: string | null }) =>
  target.confirmationToken
    ? `/checkout/confirmation?t=${encodeURIComponent(target.confirmationToken)}`
    : `/account/orders/${encodeURIComponent(target.reference)}`;

/** The page's path on that surface's own host, or null when the target has no page there. */
export function pathFor(target: NotificationTarget, surface: Surface): string | null {
  switch (target.type) {
    case 'order':
      if (surface === 'admin') return `/sales/orders/${target.orderId}`;
      if (surface === 'store') return orderStorePath(target);
      return null;
    case 'return':
      if (surface === 'admin') return `/sales/returns/${target.returnId}`;
      if (surface === 'store') return orderStorePath(target);
      return null;
    case 'dispute':
      if (surface === 'admin') return `/sales/orders/${target.orderId}`;
      if (surface === 'platform') return '/platform/payments?tab=disputes';
      return null;
    case 'conversation':
      if (surface === 'admin') return `/messages?c=${encodeURIComponent(target.conversationId)}`;
      if (surface === 'store') return '/chat';
      return null;
    case 'low-stock':
      return surface === 'admin' ? `/inventory/warehouses/${target.warehouseId}?tab=inventory&stock=low` : null;
    case 'platform':
      return surface === 'platform' && target.path.startsWith('/platform') ? target.path : null;
  }
}

/** The full address, for an email or a browser. `store` is needed for admin and store pages. */
export function urlFor(target: NotificationTarget, surface: Surface, store: StoreOrigins | null): string | null {
  const path = pathFor(target, surface);
  if (!path) return null;
  if (surface === 'platform') return getMarketingUrl(path);
  if (!store) return null;
  return surface === 'admin' ? getAdminUrl(store.slug, path) : storeUrl(store, path);
}

/** The same store page inside the shop's app (read by components/native/native-shell.tsx). */
export function appPathFor(target: NotificationTarget, slug: string): string | null {
  const path = pathFor(target, 'store');
  return path ? `/s/${slug}${path}` : null;
}
