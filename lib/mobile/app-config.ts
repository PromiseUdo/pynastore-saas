/*
 * lib/mobile/app-config.ts
 *
 * Which phone app a request on the mobile origin comes from, and where it may
 * go (ROADMAP 16.1). Pure and DB-free — safe to call on every request from
 * proxy.ts; the database lookup lives in ./store-apps.ts.
 *
 * Every app is a thin native shell around the live mobile origin, so ONE
 * deployment serves them all. An app says which one it is by adding
 * `MansaasApp/{appId}` to its WebView's user agent (capacitor.config.ts):
 *
 *   mall     — the shared app (com.mansaas.app), or no marker at all (a
 *              browser, or a build from before 16.1). `/` shows the store
 *              picker; any `/s/{slug}` reaches that store.
 *
 *   branded  — a store's own app, registered in `MobileApp` and ACTIVE.
 *              `/` opens straight into that store, there is no picker, and
 *              links to any other store are bounced home.
 *
 *   closed   — a store's app whose add-on lapsed, or a build nobody
 *              registered. Every path shows "This app is no longer
 *              available" (with the store's website, when we know it).
 *
 * The marker can be forged, and that's fine: it only narrows what a request
 * can see, and everything it can see is the public storefront.
 */

/** The shared app's id, which is also its URL scheme. */
export const SHARED_APP_ID = process.env.NEXT_PUBLIC_MOBILE_APP_SCHEME || 'com.mansaas.app';

/** The user-agent token every app build appends (capacitor.config.ts). */
export const APP_USER_AGENT_TOKEN = 'MansaasApp';

/**
 * Added beside the marker by a build that can receive push notifications
 * (ROADMAP 16.4) — on Android only when the build carried the Firebase
 * config, since asking an Android app without it to register would fail.
 */
export const PUSH_USER_AGENT_TOKEN = 'MansaasPush';

export function userAgentHasPush(userAgent: string | null | undefined): boolean {
  return new RegExp(`(?:^|\\s)${PUSH_USER_AGENT_TOKEN}(?:\\s|$)`).test(userAgent ?? '');
}

/** The phone a request comes from, by its user agent. */
export function pushPlatformFromUserAgent(userAgent: string | null | undefined): 'ANDROID' | 'IOS' | null {
  const ua = userAgent ?? '';
  if (/Android/i.test(ua)) return 'ANDROID';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'IOS';
  return null;
}

/** Reverse-DNS app ids, as Apple and Google accept them. */
const APP_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i;

export function isValidAppId(value: string): boolean {
  return value.length <= 150 && APP_ID_PATTERN.test(value);
}

/** The app id a request's user agent names, or null when it names none. */
export function appIdFromUserAgent(userAgent: string | null | undefined): string | null {
  const match = (userAgent ?? '').match(new RegExp(`(?:^|\\s)${APP_USER_AGENT_TOKEN}/(\\S+)`));
  const id = match?.[1] ?? null;
  return id && isValidAppId(id) ? id : null;
}

export type MobileApp =
  | { mode: 'mall'; lockedSlug: null }
  | { mode: 'branded'; lockedSlug: string }
  /** `lockedSlug` is the store whose app this was, when it was registered */
  | { mode: 'closed'; lockedSlug: string | null };

export const MALL_APP: MobileApp = { mode: 'mall', lockedSlug: null };

/** Internal route for a closed app (app/(mobile)/m/app-unavailable). */
export const APP_UNAVAILABLE_PATH = '/m/app-unavailable';

/*
 * The routing decision for a request on the mobile origin. proxy.ts turns
 * each variant into the corresponding rewrite/redirect and owns the
 * tenant-header stamping.
 *
 *   mpath       — a picker route (`/m`, `/m/...`); serve it as-is.
 *   picker      — the app root in mall mode; rewrite to the picker (`/m`).
 *   storefront  — reach this tenant's storefront (internal `/store/{slug}`).
 *   unavailable — a closed app; show the "no longer available" page.
 *   home        — not allowed here; redirect to the mobile origin root.
 */
export type MobileRoute =
  | { kind: 'mpath' }
  | { kind: 'picker' }
  | { kind: 'storefront'; slug: string; rest: string }
  | { kind: 'unavailable'; slug: string | null }
  | { kind: 'home' };

export function resolveMobileRoute(pathname: string, app: MobileApp): MobileRoute {
  // A closed app reaches nothing but its own explanation.
  if (app.mode === 'closed') {
    return pathname === APP_UNAVAILABLE_PATH ? { kind: 'mpath' } : { kind: 'unavailable', slug: app.lockedSlug };
  }

  // A store's own app: the whole app is one store. No picker; other stores blocked.
  if (app.mode === 'branded') {
    if (pathname === '/') return { kind: 'storefront', slug: app.lockedSlug, rest: '' };

    const m = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (m) {
      const [, slug, rest = ''] = m;
      return slug === app.lockedSlug
        ? { kind: 'storefront', slug: app.lockedSlug, rest }
        : { kind: 'home' };
    }

    // Shown when the store itself is gone (proxy.ts).
    if (pathname === APP_UNAVAILABLE_PATH) return { kind: 'mpath' };

    // The picker has no place in a store's own app.
    if (pathname === '/m' || pathname.startsWith('/m/')) return { kind: 'home' };

    // Everything else is a page of THE store. The storefront's own links are
    // slug-free (/products/x, /cart), so they must land here rather than
    // bounce home. Nothing outside the storefront is reachable this way: the
    // path is served from inside /store/{slug}, where an admin path is a 404.
    return { kind: 'storefront', slug: app.lockedSlug, rest: pathname };
  }

  // The shared app (mall).
  if (pathname === '/') return { kind: 'picker' };
  if (pathname === '/m' || pathname.startsWith('/m/')) return { kind: 'mpath' };

  const m = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
  if (!m) return { kind: 'home' };
  const [, slug, rest = ''] = m;
  return { kind: 'storefront', slug, rest };
}
