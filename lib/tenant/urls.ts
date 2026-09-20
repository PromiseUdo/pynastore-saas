/*
 * lib/tenant/urls.ts
 *
 * Builds absolute, cross-subdomain URLs for a given org. Needed anywhere a
 * link/redirect must point at a *different* origin than the current
 * request (switching orgs, post-login/post-onboarding redirect, email
 * links) — same-org navigation should just use ordinary relative paths.
 */
import {
  getMobileDomain,
  getPlatformHost,
  getRootDomain,
  isLocalHostname,
  storefrontHostsFor,
} from './resolveHostname';

function protocolFor(host: string): string {
  return isLocalHostname(host) ? 'http' : 'https';
}

function getProtocol(): string {
  return protocolFor(getRootDomain());
}

export function getAdminUrl(orgSlug: string, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getProtocol()}://${orgSlug}.${getRootDomain()}${suffix}`;
}

export function getStorefrontUrl(orgSlug: string, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
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
