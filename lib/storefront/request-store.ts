/*
 * lib/storefront/request-store.ts
 *
 * Which store a storefront API request belongs to — decided by the SERVER,
 * from the same signals proxy.ts uses for pages.
 *
 * proxy.ts skips /api entirely (its matcher excludes it), so the storefront
 * API routes — discover, assistant, recommendations — never get the
 * x-org-slug header pages get. They used to take the store from the `org`
 * field of the request body instead, which let any request name any store.
 * This resolves it the proxy's way:
 *
 *   STORE HOSTS — shop-{slug}.{ROOT_DOMAIN}, or a merchant's custom store
 *   domain. The hostname IS the store (resolveHostname → resolveTenant,
 *   exactly as the proxy does). A body `org` is still accepted from older
 *   clients, but only if it names this same store; anything else is refused.
 *
 *   THE MOBILE MALL — m.{ROOT_DOMAIN} / MOBILE_DOMAIN. One hostname for every
 *   store, by design; the store travels in the page path, /s/{slug}. The
 *   request's Referer is that page, so its path is run through the proxy's
 *   own resolveMobileRoute() — the same rules that decide which store a page
 *   renders, including a branded build's locked store. A body `org` must
 *   agree with it. Only when the browser sent no Referer (a privacy setting)
 *   does the body `org` stand in, and then only if it's a store the mobile
 *   routing would serve at /s/{org} anyway.
 *
 *   ANYTHING ELSE — the admin, marketing, or an unknown host — is not a
 *   storefront, and is refused.
 *
 * In every case the store must exist and be ACTIVE. The result is a slug the
 * route then uses as its only StoreScope.
 */
import { getMobileApp, resolveMobileRoute } from '@/lib/mobile/app-config';
import { resolveHostname } from '@/lib/tenant/resolveHostname';
import { resolveTenant, resolveTenantBySlug } from '@/lib/tenant/resolveTenant';

export type RequestStore =
  | {
      ok: true;
      slug: string;
      /** how the store was established — for tests and logs */
      via: 'host' | 'mobile-route' | 'mobile-claim';
    }
  | { ok: false; status: 400 | 403 | 404; error: string };

const NOT_A_STOREFRONT = { ok: false, status: 400, error: 'Not a storefront request.' } as const;
const NOT_FOUND = { ok: false, status: 404, error: 'Store not found.' } as const;
const MISMATCH = { ok: false, status: 403, error: 'This request doesn’t match the store you’re on.' } as const;

/**
 * @param claimedOrg the body's `org`, if the client sent one. Never the
 *   source of truth on a store host; a cross-check everywhere.
 */
export async function resolveRequestStore(request: Request, claimedOrg?: string | null): Promise<RequestStore> {
  const claimed = claimedOrg?.trim() || null;
  const host = request.headers.get('host') ?? safeHost(request.url);
  const info = resolveHostname(host);

  /* ── a store's own hostname ─────────────────────────────────────────── */
  if (info.siteType === 'storefront' || info.isCustomDomain) {
    const tenant = await resolveTenant(info);
    if (!tenant || tenant.siteType !== 'storefront') {
      return info.isCustomDomain ? NOT_FOUND : NOT_A_STOREFRONT;
    }
    if (claimed && claimed !== tenant.orgSlug) return MISMATCH;
    // A subdomain resolves without a lookup; make sure it's a live store.
    if (!(await resolveTenantBySlug(tenant.orgSlug))) return NOT_FOUND;
    return { ok: true, slug: tenant.orgSlug, via: 'host' };
  }

  /* ── the mobile mall: the store is in the page's /s/{slug} path ─────── */
  if (info.siteType === 'mobile') {
    const app = getMobileApp();
    const page = refererPath(request, host);
    const fromPage = page ? resolveMobileRoute(page, app) : null;

    if (fromPage?.kind === 'storefront') {
      if (claimed && claimed !== fromPage.slug) return MISMATCH;
      const tenant = await resolveTenantBySlug(fromPage.slug);
      return tenant ? { ok: true, slug: tenant.orgSlug, via: 'mobile-route' } : NOT_FOUND;
    }

    // No usable page (Referer stripped, or not a store page): accept the
    // claimed store only if the mobile routing would serve it — in a branded
    // build that's its one store and nothing else.
    if (!claimed) return NOT_A_STOREFRONT;
    const asRoute = resolveMobileRoute(`/s/${encodeURIComponent(claimed)}`, app);
    if (asRoute.kind !== 'storefront' || asRoute.slug !== claimed) return MISMATCH;
    const tenant = await resolveTenantBySlug(claimed);
    return tenant ? { ok: true, slug: tenant.orgSlug, via: 'mobile-claim' } : NOT_FOUND;
  }

  return NOT_A_STOREFRONT;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** The Referer's path — only when it's a page on this same host. */
function refererPath(request: Request, host: string | null): string | null {
  const referer = request.headers.get('referer');
  if (!referer || !host) return null;
  try {
    const url = new URL(referer);
    return url.host.toLowerCase() === host.toLowerCase() ? url.pathname : null;
  } catch {
    return null;
  }
}
