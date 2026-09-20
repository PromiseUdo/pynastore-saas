/*
 * lib/tenant/resolveHostname.ts
 *
 * Pure, DB-free parsing of a request's `host` header into a structured
 * description of what kind of site is being requested. No Prisma here —
 * this is unit-testable in isolation and safe to call on every request.
 *
 * Recognized shapes (ROOT_DOMAIN from NEXT_PUBLIC_ROOT_DOMAIN):
 *   {ROOT_DOMAIN}                 -> marketing
 *   www.{ROOT_DOMAIN}             -> marketing
 *   {slug}.{ROOT_DOMAIN}          -> admin,      subdomain = slug
 *   shop.{slug}.{ROOT_DOMAIN}     -> storefront, subdomain = slug
 *   {MOBILE_DOMAIN} / m.{ROOT_DOMAIN} -> mobile (single-origin host for the
 *                                    Capacitor app; slug travels in the path
 *                                    as /s/{slug}/... — see proxy.ts)
 *   anything else                 -> unknown + isCustomDomain (resolved via DB)
 *
 * Dev-only: in development, any otherwise-unrecognized host
 * (e.g. a bare LAN IP from `cap run --live-reload --external`) is treated as
 * the mobile host so on-device live reload works without extra config.
 */

export type SiteType = 'marketing' | 'admin' | 'storefront' | 'mobile';

export interface HostnameInfo {
  hostname: string;
  siteType: SiteType | 'unknown';
  /** Org slug parsed directly from a `*.{ROOT_DOMAIN}` subdomain. Null when
   *  the site is marketing, or when the hostname is a custom domain that
   *  requires a DB lookup to resolve. */
  subdomain: string | null;
  /** True when the hostname isn't a recognized `*.{ROOT_DOMAIN}` shape —
   *  the tenant (if any) must be resolved via a DB lookup. */
  isCustomDomain: boolean;
}

const STOREFRONT_PREFIX = 'shop.';
const MOBILE_PREFIX = 'm.';

export function getRootDomain(): string {
  return process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
}

/** Dedicated single-origin host for the Capacitor mobile app, if configured. */
export function getMobileDomain(): string | null {
  return process.env.NEXT_PUBLIC_MOBILE_DOMAIN?.toLowerCase().trim() || null;
}

/** True for "localhost", "localhost:3000", "app.localhost:3000", etc. — any host under the *.localhost TLD. */
export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.startsWith('localhost:') || hostname.includes('.localhost');
}

export function resolveHostname(hostHeader: string | null): HostnameInfo {
  const hostname = (hostHeader ?? '').toLowerCase().trim();
  const rootDomain = getRootDomain();
  const mobileDomain = getMobileDomain();

  if (!hostname || hostname === rootDomain || hostname === `www.${rootDomain}`) {
    return { hostname, siteType: 'marketing', subdomain: null, isCustomDomain: false };
  }

  // Dedicated mobile origin — an explicit MOBILE_DOMAIN, or the m.{ROOT_DOMAIN} shape.
  if (
    (mobileDomain && hostname === mobileDomain) ||
    hostname === `${MOBILE_PREFIX}${rootDomain}`
  ) {
    return { hostname, siteType: 'mobile', subdomain: null, isCustomDomain: false };
  }

  if (hostname.endsWith(`.${rootDomain}`)) {
    const label = hostname.slice(0, hostname.length - rootDomain.length - 1);

    if (label.startsWith(STOREFRONT_PREFIX)) {
      const subdomain = label.slice(STOREFRONT_PREFIX.length);
      if (!subdomain) {
        return { hostname, siteType: 'marketing', subdomain: null, isCustomDomain: false };
      }
      return { hostname, siteType: 'storefront', subdomain, isCustomDomain: false };
    }

    return { hostname, siteType: 'admin', subdomain: label, isCustomDomain: false };
  }

  // Dev-only: an unrecognized host in development is almost always a LAN IP
  // from `cap run --live-reload --external`. Treat it as the mobile origin so
  // on-device live reload needs no extra setup.
  if (process.env.NODE_ENV === 'development') {
    return { hostname, siteType: 'mobile', subdomain: null, isCustomDomain: false };
  }

  // Not a subdomain of ROOT_DOMAIN — candidate custom domain (customAdminDomain
  // or customStoreDomain). Actual siteType/org is resolved by resolveTenant().
  return { hostname, siteType: 'unknown', subdomain: null, isCustomDomain: true };
}
