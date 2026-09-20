/*
 * lib/mobile/app-config.ts
 *
 * The single seam between the two mobile-app tiers. Pure and DB-free — safe
 * to call on every request from proxy.ts.
 *
 *   mode = 'mall'    (default) — one app, many stores. `/` shows the store
 *                     picker; any `/s/{slug}` reaches that tenant's storefront.
 *                     This is the standard experience for every merchant.
 *
 *   mode = 'branded' (future premium add-on) — a per-merchant build whose
 *                     tenant is baked in at build time via
 *                     NEXT_PUBLIC_MOBILE_APP_SLUG. `/` opens straight into
 *                     that store, there is no picker, and links to any other
 *                     store are bounced home. One shared codebase still
 *                     serves it — only these env vars differ per build.
 *
 * Nothing here builds or publishes those per-merchant apps; that pipeline
 * (icons, splash, bundle id, signing, store submission) is deliberately
 * out of scope for now. See MOBILE.md.
 */

export type MobileAppMode = 'mall' | 'branded';

export interface MobileApp {
  mode: MobileAppMode;
  /** In 'branded' mode, the org slug this build is locked to. Null in 'mall' mode. */
  lockedSlug: string | null;
}

function normalizeSlug(raw: string | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return s || null;
}

/** Reads the current build's mobile-app configuration from the environment. */
export function getMobileApp(): MobileApp {
  const lockedSlug = normalizeSlug(process.env.NEXT_PUBLIC_MOBILE_APP_SLUG);
  const mode: MobileAppMode =
    process.env.NEXT_PUBLIC_MOBILE_APP_MODE === 'branded' && lockedSlug ? 'branded' : 'mall';
  return { mode, lockedSlug: mode === 'branded' ? lockedSlug : null };
}

/*
 * The routing decision for a request on the dedicated mobile origin, given
 * its path and the current build's config. proxy.ts turns each variant into
 * the corresponding rewrite/redirect and owns the tenant-header stamping.
 *
 *   mpath      — a picker route (`/m`, `/m/...`); serve it as-is.
 *   picker     — the app root in mall mode; rewrite to the picker (`/m`).
 *   storefront — reach this tenant's storefront (internal `/store/{slug}`).
 *   home       — not allowed here; redirect to the mobile origin root.
 */
export type MobileRoute =
  | { kind: 'mpath' }
  | { kind: 'picker' }
  | { kind: 'storefront'; slug: string; rest: string }
  | { kind: 'home' };

export function resolveMobileRoute(pathname: string, app: MobileApp): MobileRoute {
  // Branded build: the whole app is one store. No picker; foreign stores blocked.
  if (app.mode === 'branded' && app.lockedSlug) {
    if (pathname === '/') return { kind: 'storefront', slug: app.lockedSlug, rest: '' };

    const m = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (m) {
      const [, slug, rest = ''] = m;
      return slug === app.lockedSlug
        ? { kind: 'storefront', slug: app.lockedSlug, rest }
        : { kind: 'home' };
    }

    // The picker has no place in a branded app.
    return { kind: 'home' };
  }

  // Mall build (default).
  if (pathname === '/') return { kind: 'picker' };
  if (pathname === '/m' || pathname.startsWith('/m/')) return { kind: 'mpath' };

  const m = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
  if (!m) return { kind: 'home' };
  const [, slug, rest = ''] = m;
  return { kind: 'storefront', slug, rest };
}
