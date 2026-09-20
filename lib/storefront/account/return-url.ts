/*
 * lib/storefront/account/return-url.ts
 *
 * Where a shopper may be sent back to after signing in.
 *
 * Two different questions, both answered here so neither is answered twice:
 *
 *   safeNextPath()   — a `?next=` inside one store. Must be a plain path on
 *                      this origin. A protocol-relative "//evil.com" reads as
 *                      a path to a naive check and as a HOST to the browser,
 *                      which is the whole open-redirect trick, so it is
 *                      rejected along with anything else that isn't a single
 *                      leading slash.
 *
 *   storeReturnUrl() — an ABSOLUTE url the Google flow is allowed to hand the
 *                      session back to. This one matters: the callback runs
 *                      on the root domain and finishes by redirecting to a
 *                      store's own origin, so an unchecked value here would
 *                      let a crafted link deliver a real, valid session to a
 *                      host the attacker controls. A candidate is accepted
 *                      only if its host is one of the three shapes this
 *                      platform actually serves the store on, for THAT slug.
 */
import { getMobileDomain, isLocalHostname, storefrontHostsFor } from '@/lib/tenant/resolveHostname';

/** A same-origin path, or the given fallback. */
export function safeNextPath(value: string | null | undefined, fallback = '/account'): string {
  if (!value) return fallback;
  const path = value.trim();
  if (!path.startsWith('/')) return fallback;
  if (path.startsWith('//')) return fallback;
  // A backslash is normalised to a slash by some browsers ("/\evil.com").
  if (path.startsWith('/\\')) return fallback;
  return path;
}

export interface StoreOrigins {
  slug: string;
  /** Organization.customStoreDomain, when the merchant has one */
  customStoreDomain?: string | null;
}

/**
 * Every hostname this store is legitimately served on.
 *
 * The platform hostnames come from storefrontHostsFor() — the same function
 * getStorefrontUrl() builds links from — so this allow-list cannot fall out
 * of step with the host shoppers are actually on. It stays an exact match
 * against hosts built for THIS slug; nothing here widens to a pattern.
 */
export function allowedStoreHosts({ slug, customStoreDomain }: StoreOrigins): string[] {
  const hosts = storefrontHostsFor(slug);
  const mobile = getMobileDomain();
  if (mobile) hosts.push(mobile);
  if (customStoreDomain) hosts.push(customStoreDomain.toLowerCase());
  return hosts;
}

/**
 * Validate an absolute return URL against a store, and normalise it.
 *
 * On the mobile origin the slug lives in the path rather than the host, so
 * the path is checked too: `m.example.com/s/acme/...` is acme's, and
 * `m.example.com/s/zed/...` is not, even though the host matches.
 */
export function storeReturnUrl(candidate: string, store: StoreOrigins): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.host.toLowerCase();
  if (!allowedStoreHosts(store).includes(host)) return null;

  const mobile = getMobileDomain();
  if (mobile && host === mobile) {
    const prefix = `/s/${store.slug}`;
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  }

  return url.toString();
}

/**
 * An absolute URL on the store's own front door — the merchant's custom
 * domain when they have one, otherwise the platform subdomain. Used for
 * links that leave the app and come back (password reset emails), where a
 * relative path has nothing to resolve against.
 */
export function storeUrl(store: StoreOrigins, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const host = store.customStoreDomain?.toLowerCase() || storefrontHostsFor(store.slug)[0];
  const protocol = isLocalHostname(host) ? 'http' : 'https';
  return `${protocol}://${host}${suffix}`;
}
