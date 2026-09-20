/*
 * lib/tenant/urls.ts
 *
 * Builds absolute, cross-subdomain URLs for a given org. Needed anywhere a
 * link/redirect must point at a *different* origin than the current
 * request (switching orgs, post-login/post-onboarding redirect, email
 * links) — same-org navigation should just use ordinary relative paths.
 */
import { getRootDomain, getMobileDomain, isLocalHostname } from './resolveHostname';

function getProtocol(): string {
  return isLocalHostname(getRootDomain()) ? 'http' : 'https';
}

export function getAdminUrl(orgSlug: string, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getProtocol()}://${orgSlug}.${getRootDomain()}${suffix}`;
}

export function getStorefrontUrl(orgSlug: string, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getProtocol()}://shop.${orgSlug}.${getRootDomain()}${suffix}`;
}

export function getMarketingUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getProtocol()}://${getRootDomain()}${suffix}`;
}

/**
 * Absolute URL on the dedicated mobile origin (the Capacitor app's single
 * server host). Falls back to `m.{ROOT_DOMAIN}` when NEXT_PUBLIC_MOBILE_DOMAIN
 * is unset. Storefront paths there are /s/{slug}/....
 */
export function getMobileUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const domain = getMobileDomain() ?? `m.${getRootDomain()}`;
  return `${getProtocol()}://${domain}${suffix}`;
}

export function getMobileStorefrontUrl(orgSlug: string, path = '/'): string {
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return getMobileUrl(`/s/${orgSlug}${suffix}`);
}
