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
 *   {PLATFORM_HOST}               -> marketing (the authenticated platform
 *                                    origin: NEXT_PUBLIC_PLATFORM_HOST, e.g.
 *                                    app.getnotely.io. Defaults to
 *                                    ROOT_DOMAIN, which is what local dev
 *                                    uses — there the two are the same host.)
 *   shop-{slug}.{ROOT_DOMAIN}     -> storefront, subdomain = slug
 *   shop.{slug}.{ROOT_DOMAIN}     -> storefront, subdomain = slug (legacy;
 *                                    still accepted so existing links and the
 *                                    local dev hosts keep working)
 *   {slug}.{ROOT_DOMAIN}          -> admin,      subdomain = slug
 *   {MOBILE_DOMAIN} / m.{ROOT_DOMAIN} -> mobile (single-origin host for the
 *                                    Capacitor app; slug travels in the path
 *                                    as /s/{slug}/... — see proxy.ts)
 *   anything else                 -> unknown + isCustomDomain (resolved via DB)
 *
 * The storefront prefix is ONE label (`shop-`) on purpose: every platform
 * hostname is then a single label under ROOT_DOMAIN, which one wildcard
 * certificate covers. The two-label `shop.{slug}.` shape it replaced needed
 * a certificate per tenant.
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

/** Current: one label, so a single wildcard cert covers every storefront. */
const STOREFRONT_PREFIX = 'shop-';
/** Previous two-label shape. Still parsed; never generated. */
const LEGACY_STOREFRONT_PREFIX = 'shop.';
const MOBILE_PREFIX = 'm.';

export function getRootDomain(): string {
  return process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
}

/**
 * The origin that serves marketing, sign-in and everything else that isn't a
 * tenant. In production it is its own host (app.{ROOT_DOMAIN}) so that
 * {slug}.{ROOT_DOMAIN} can be a tenant; unset — as in local dev, where the
 * root domain already IS the platform host — it falls back to ROOT_DOMAIN and
 * nothing about the current behaviour changes.
 */
export function getPlatformHost(): string {
  return process.env.NEXT_PUBLIC_PLATFORM_HOST?.toLowerCase().trim() || getRootDomain();
}

/** Dedicated single-origin host for the Capacitor mobile app, if configured. */
export function getMobileDomain(): string | null {
  return process.env.NEXT_PUBLIC_MOBILE_DOMAIN?.toLowerCase().trim() || null;
}

/**
 * Every platform hostname that serves this store, canonical first.
 *
 * The ONE place the storefront host shape is written down. lib/tenant/urls.ts
 * builds public URLs from [0]; lib/storefront/account/return-url.ts uses the
 * whole list as the allow-list for handing a shopper session back after the
 * Google round trip. Deriving both from here is what stops the generator and
 * the security check drifting apart. A merchant's own custom domain is not a
 * platform hostname and is added by the caller that knows about it.
 */
export function storefrontHostsFor(slug: string): string[] {
  const root = getRootDomain();
  return [`${STOREFRONT_PREFIX}${slug}.${root}`, `${LEGACY_STOREFRONT_PREFIX}${slug}.${root}`];
}

/** True for "localhost", "localhost:3000", "app.localhost:3000", etc. — any host under the *.localhost TLD. */
export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.startsWith('localhost:') || hostname.includes('.localhost');
}

export function resolveHostname(hostHeader: string | null): HostnameInfo {
  const hostname = (hostHeader ?? '').toLowerCase().trim();
  const rootDomain = getRootDomain();
  const platformHost = getPlatformHost();
  const mobileDomain = getMobileDomain();

  const marketing = (): HostnameInfo => ({
    hostname,
    siteType: 'marketing',
    subdomain: null,
    isCustomDomain: false,
  });

  // The platform host is checked first because it is itself a subdomain of
  // ROOT_DOMAIN in production: without this, app.{ROOT_DOMAIN} would parse as
  // a tenant admin site for an organization called "app".
  if (!hostname || hostname === rootDomain || hostname === `www.${rootDomain}` || hostname === platformHost) {
    return marketing();
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

    for (const prefix of [STOREFRONT_PREFIX, LEGACY_STOREFRONT_PREFIX]) {
      if (!label.startsWith(prefix)) continue;
      const subdomain = label.slice(prefix.length);
      // "shop-.{root}" / "shop..{root}" name no store.
      if (!subdomain) return marketing();
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
