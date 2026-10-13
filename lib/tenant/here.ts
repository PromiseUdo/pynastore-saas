/*
 * lib/tenant/here.ts
 *
 * Server side: links that must stay on the host the request came in on.
 *
 * The admin normally lives on {slug}.{ROOT_DOMAIN} and signs in on the
 * platform host. The business host (b.{ROOT_DOMAIN}, ROADMAP 19) serves both
 * on ONE origin, and the business app can't follow a link off it. So code
 * that sends someone to "their shop" or "sign in" asks here instead of
 * calling getAdminUrl / getMarketingUrl directly.
 *
 * Decided from the request's Host header (the proxy leaves it as the browser
 * sent it). A forged one only changes which of our own hosts a redirect
 * points at; it grants nothing, since every admin page re-checks membership.
 */
import { headers } from 'next/headers';
import { resolveHostname } from './resolveHostname';
import { getAdminUrl, getBusinessEntryUrl, getBusinessUrl, getMarketingUrl } from './urls';

export async function isBusinessRequest(): Promise<boolean> {
  let host: string | null;
  try {
    host = (await headers()).get('host');
  } catch {
    // Outside a request (a job, a script): nothing to stay on.
    return false;
  }
  return resolveHostname(host).siteType === 'business';
}

/**
 * A page of this shop, for someone whose session may be in another shop:
 * on the business host it goes through `/o/{slug}/…`, which switches first.
 */
export async function adminUrlHere(orgSlug: string, path = '/'): Promise<string> {
  return (await isBusinessRequest()) ? getBusinessEntryUrl(orgSlug, path) : getAdminUrl(orgSlug, path);
}

/**
 * A page of the shop the session has JUST been switched to
 * (updateCurrentOrganization ran in this same request), so on the business
 * host it's the plain page.
 */
export async function currentShopUrlHere(orgSlug: string, path = '/'): Promise<string> {
  return (await isBusinessRequest()) ? getBusinessUrl(path) : getAdminUrl(orgSlug, path);
}

/**
 * Where sign-in sends someone afterwards. Auth.js resolves a relative target
 * against AUTH_URL (the platform host), which would take a business-host
 * visitor off it — so there a relative target is made absolute on this host.
 * Elsewhere it is returned unchanged.
 */
export async function signInTargetHere(target: string): Promise<string> {
  if (!target.startsWith('/') || target.startsWith('//')) return target;
  return (await isBusinessRequest()) ? getBusinessUrl(target) : target;
}

/**
 * An account page (verify email, reset password) for a link in an email
 * this request is sending: on the business host when that's where the
 * person is, so they come back to it (ROADMAP 19.2), the platform host
 * otherwise.
 */
export async function accountUrlHere(path: string): Promise<string> {
  return (await isBusinessRequest()) ? getBusinessUrl(path) : getMarketingUrl(path);
}
