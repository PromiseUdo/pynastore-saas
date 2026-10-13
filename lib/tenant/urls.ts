/*
 * lib/tenant/urls.ts
 *
 * Builds absolute, cross-subdomain URLs for a given org. Needed anywhere a
 * link/redirect must point at a *different* origin than the current
 * request (switching orgs, post-login/post-onboarding redirect, email
 * links) — same-org navigation should just use ordinary relative paths.
 */
import {
  getBusinessDomain,
  getMobileDomain,
  getPlatformHost,
  getRootDomain,
  isLocalHostname,
  resolveHostname,
  storefrontHostsFor,
} from './resolveHostname';

/**
 * A LAN name like b.192-168-1-4.nip.io — how a phone or simulator reaches a
 * laptop's `next dev`, which serves plain http (docs/MOBILE-BUILD.md §8.4).
 * Only those wildcard-IP names, only in development: a real domain stays
 * https whatever the build is called (a tunnel, staging).
 */
const LAN_DEV_NAME = /\.(nip|sslip)\.io(:\d+)?$/i;

function protocolFor(host: string): string {
  if (isLocalHostname(host)) return 'http';
  return process.env.NODE_ENV === 'development' && LAN_DEV_NAME.test(host) ? 'http' : 'https';
}

function getProtocol(): string {
  return protocolFor(getRootDomain());
}

export function getAdminUrl(orgSlug: string, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getProtocol()}://${orgSlug}.${getRootDomain()}${suffix}`;
}

/**
 * The shop's address. Pass the shop's live custom domain (its canonical www
 * host, `Organization.customStoreDomain`) when you have it — every link we
 * generate should use it once it's live (ROADMAP 12.6). Server code without
 * it to hand can use `storefrontUrlFor` in lib/domains/storefront-url.ts.
 */
export function getStorefrontUrl(orgSlug: string, path = '/', customDomain?: string | null): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (customDomain) return `https://${customDomain}${suffix}`;
  // [0] is the canonical storefront host; see storefrontHostsFor().
  const host = storefrontHostsFor(orgSlug)[0];
  return `${protocolFor(host)}://${host}${suffix}`;
}

/**
 * The platform origin — marketing, sign-in, invitations, OAuth callbacks.
 *
 * In production this is NEXT_PUBLIC_PLATFORM_HOST (app.{ROOT_DOMAIN}), not
 * the apex: the apex may serve a marketing site, but everything the
 * application itself generates a link to lives on the platform host. With
 * that var unset it is ROOT_DOMAIN, which is the local-dev arrangement.
 */
export function getMarketingUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const host = getPlatformHost();
  return `${protocolFor(host)}://${host}${suffix}`;
}

/**
 * Absolute URL on the dedicated mobile origin (the Capacitor app's single
 * server host). Falls back to `m.{ROOT_DOMAIN}` when NEXT_PUBLIC_MOBILE_DOMAIN
 * is unset. Storefront paths there are /s/{slug}/....
 */
export function getMobileUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const domain = getMobileDomain() ?? `m.${getRootDomain()}`;
  return `${protocolFor(domain)}://${domain}${suffix}`;
}

export function getMobileStorefrontUrl(orgSlug: string, path = '/'): string {
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return getMobileUrl(`/s/${orgSlug}${suffix}`);
}

/**
 * Absolute URL on the business host (ROADMAP 19): the admin for whichever
 * shop the session is in, plus sign-in and onboarding. Paths are the admin's
 * own, slug-free ones (/orders/123).
 */
export function getBusinessUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const domain = getBusinessDomain();
  return `${protocolFor(domain)}://${domain}${suffix}`;
}

/**
 * The business host's link to a page of ONE shop: `/o/{slug}/{path}`. Opening
 * it switches the session to that shop (when the person is a member) and
 * lands on the page — what a link must use when the session may be in
 * another shop. See lib/tenant/business.ts.
 */
export function getBusinessEntryUrl(orgSlug: string, path = '/'): string {
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return getBusinessUrl(`/o/${orgSlug}${suffix}`);
}

/**
 * Browser side: is this page on the business host? Only meaningful in the
 * browser (event handlers); during server rendering it is false. Server code
 * uses lib/tenant/here.ts instead.
 */
export function onBusinessHost(): boolean {
  return typeof window !== 'undefined' && resolveHostname(window.location.host).siteType === 'business';
}

/**
 * Browser side: a sign-in or onboarding page (/login, /onboarding) on the
 * host this page is on — the business host keeps its own, everything else
 * uses the platform host's.
 */
export function marketingUrlHere(path = '/'): string {
  return onBusinessHost() ? getBusinessUrl(path) : getMarketingUrl(path);
}
