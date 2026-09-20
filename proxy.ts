/*
 * proxy.ts — Next.js 16 replacement for middleware.ts.
 *
 * Runs on the server before every matched request. Next.js 16 defaults
 * Proxy to the Node.js runtime (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md),
 * so — unlike the old Edge-only middleware model — this file can safely
 * call Prisma (via lib/tenant/resolveTenant.ts, for the custom-domain
 * lookup path only). auth.config.ts stays a minimal, provider-free config
 * so the JWT check itself remains cheap; the membership/permission check
 * still happens in lib/organization.ts inside Server Components/Actions.
 *
 * Tenant identification comes from the request HOSTNAME, not the URL path:
 *   {ROOT_DOMAIN}              -> marketing (auth pages, home gate)
 *   {slug}.{ROOT_DOMAIN}       -> admin, internally rewritten to /${slug}/...
 *   shop.{slug}.{ROOT_DOMAIN}  -> storefront, rewritten to /store/${slug}/...
 *   a registered custom domain -> resolved via DB (see resolveTenant.ts)
 *
 * The public URL never shows the org slug — see lib/tenant/resolveHostname.ts
 * and lib/tenant/resolveTenant.ts for the resolution logic.
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authConfig } from '@/auth.config';
import { getMobileApp, resolveMobileRoute } from '@/lib/mobile/app-config';
import { prisma } from '@/lib/prisma';
import { resolveHostname, isLocalHostname } from '@/lib/tenant/resolveHostname';
import { resolveTenant, resolveTenantBySlug } from '@/lib/tenant/resolveTenant';
import { getAdminUrl, getMarketingUrl } from '@/lib/tenant/urls';

const { auth } = NextAuth(authConfig);

/* Routes that need no session at all — exact matches. Only meaningful on
 * the marketing domain; there is nothing at these paths on a tenant
 * subdomain. */
const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/forgot-password', '/reset-password']);

/* Route prefixes that are fully public (no auth required to load). */
const PUBLIC_PREFIXES = ['/invite'];

/* Routes that need a session but no tenant. */
const AUTH_ONLY_PREFIXES = ['/onboarding'];

/*
 * next-auth's auth() wrapper rewrites req.url/req.nextUrl's ORIGIN to
 * AUTH_URL before calling this function (see reqWithEnvURL in
 * next-auth/lib/env.js) — it does this so its own internal session/CSRF
 * plumbing has a stable origin, but it means req.url is unusable for
 * building redirect/callback URLs on a tenant subdomain: it would silently
 * report AUTH_URL's origin instead of the subdomain that was actually
 * requested. Headers (including `host`) are untouched by that rewrite, so
 * every absolute URL here is rebuilt from the real Host header instead.
 */
function currentUrl(req: NextRequest, hostname: string): string {
  // `next dev` serves plain http on every host — including a bare LAN IP
  // (phone testing / Capacitor debug builds), which isn't a *.localhost name.
  const isDev = process.env.NODE_ENV === 'development';
  const protocol = isDev || isLocalHostname(hostname) ? 'http' : 'https';
  return `${protocol}://${hostname}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

export default auth(async function proxy(req: NextRequest & { auth: any }) {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const hostHeader = req.headers.get('host');
  const hostInfo = resolveHostname(hostHeader);
  const isMarketing = hostInfo.siteType === 'marketing';
  const requestUrl = currentUrl(req, hostInfo.hostname || hostHeader || '');

  // ── 1. Public paths (exact match) — marketing domain only ───────────────
  if (isMarketing && PUBLIC_PATHS.has(pathname)) {
    // Already signed in — bounce away from login/register.
    //
    // GET only: server actions POST back to the page that rendered them, and
    // a redirect preserves the method + body, so the action payload would be
    // replayed against '/' — which doesn't own that action id and answers
    // "Failed to find Server Action". Let non-GET through untouched.
    if (
      req.method === 'GET' &&
      session?.user &&
      (pathname === '/login' || pathname === '/register')
    ) {
      return NextResponse.redirect(getMarketingUrl('/'));
    }

    // '/' while signed in: send the user straight to their org's subdomain.
    // This MUST happen here, not as a redirect() inside app/page.tsx — '/'
    // is frequently reached via a client-side soft navigation (e.g. right
    // after the login Server Action's own same-origin redirect to '/'), and
    // the App Router's client-side transition cannot reliably escape to a
    // different origin from inside a rendered Server Component; it just
    // re-fetches '/' forever. A Proxy-issued redirect is a real top-level
    // HTTP redirect the browser always follows, regardless of how '/' was
    // reached.
    if (req.method === 'GET' && pathname === '/' && session?.user?.id) {
      let orgSlug: string | undefined = session.currentOrgSlug;
      if (!orgSlug) {
        const membership = await prisma.membership.findFirst({
          where: { userId: session.user.id, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
          select: { organization: { select: { slug: true } } },
          orderBy: { joinedAt: 'asc' },
        });
        orgSlug = membership?.organization.slug;
      }
      return NextResponse.redirect(orgSlug ? getAdminUrl(orgSlug, '/dashboard') : getMarketingUrl('/onboarding'));
    }

    return NextResponse.next();
  }

  // ── 1b. Public prefixes — fully accessible without a session ─────────────
  //        /invite/[token] is public: the page itself handles the auth split.
  if (isMarketing && PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // ── 1c. Mobile origin — the Capacitor app's single server host ──────────
  //        Serves ONLY the customer storefront. The org slug travels in the
  //        path as /s/{slug}/... (there is no per-tenant subdomain here).
  //        Every admin/dashboard/marketing path is blocked → store picker.
  //        Runs BEFORE the auth gate: storefront browsing is public.
  //
  //        `mall` (default) vs `branded` behaviour is decided by
  //        lib/mobile/app-config.ts — the single seam for the future
  //        per-merchant branded-app tier.
  if (hostInfo.siteType === 'mobile') {
    // Redirect home on the origin the request actually arrived on — the app
    // must never leave its single origin (in dev that may be a LAN IP, not
    // MOBILE_DOMAIN, which a phone can't resolve).
    const mobileHome = new URL('/', requestUrl);

    const stampStorefront = (slug: string) => {
      const headers = new Headers(req.headers);
      headers.set('x-org-slug', slug);
      headers.set('x-site-type', 'storefront');
      headers.set('x-runtime', 'mobile');
      return headers;
    };

    // Second pass: the request was already rewritten to /store/{slug}/...
    // (the rewritten path still matches config.matcher) — just forward the
    // tenant headers, don't rewrite again.
    const rewritten = pathname.match(/^\/store\/([^/]+)(?:\/.*)?$/);
    if (rewritten) {
      return NextResponse.next({ request: { headers: stampStorefront(rewritten[1]) } });
    }

    const route = resolveMobileRoute(pathname, getMobileApp());

    if (route.kind === 'mpath') return NextResponse.next();
    if (route.kind === 'picker') return NextResponse.rewrite(new URL('/m', requestUrl));
    if (route.kind === 'home') return NextResponse.redirect(mobileHome);

    const tenant = await resolveTenantBySlug(route.slug);
    if (!tenant) {
      // Unknown slug. In a branded build redirecting home would loop, so
      // fall back to the picker as an error surface.
      return NextResponse.rewrite(new URL('/m', requestUrl));
    }

    const rewriteUrl = new URL(
      `/store/${tenant.orgSlug}${route.rest}${req.nextUrl.search}`,
      requestUrl,
    );
    return NextResponse.rewrite(rewriteUrl, { request: { headers: stampStorefront(tenant.orgSlug) } });
  }

  // ── 2. Resolve the tenant from the hostname ─────────────────────────────
  //      Done BEFORE the auth gate: a subdomain / custom-domain storefront
  //      is publicly browsable and must never be bounced to login. Only
  //      admin surfaces (and non-public marketing routes) require a session.
  //      Individual storefront routes that need a customer login (checkout,
  //      account) guard themselves.
  const tenant = isMarketing ? null : await resolveTenant(hostInfo);

  if (!isMarketing && !tenant) {
    return NextResponse.redirect(getMarketingUrl('/'));
  }

  // ── 3. Auth gate — admin surfaces + non-public marketing routes ─────────
  //      Login only happens on the marketing domain (its session cookie is
  //      shared across *.{ROOT_DOMAIN} — see auth.config.ts). Preserve the
  //      real, current absolute URL (which may be on a tenant subdomain) as
  //      the callback so auth.config.ts's redirect callback can send the
  //      user back there after sign-in.
  const needsSession = isMarketing || tenant?.siteType === 'admin';
  if (needsSession && !session?.user?.id) {
    const loginUrl = new URL(getMarketingUrl('/login'));
    loginUrl.searchParams.set('callbackUrl', requestUrl);
    return NextResponse.redirect(loginUrl);
  }

  // ── 3b. Auth-only routes (no tenant required) — marketing domain only ───
  if (isMarketing && AUTH_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // ── 4. Marketing domain has no tenant-scoped content beyond the above ───
  if (isMarketing) {
    if (pathname === '/') return NextResponse.next();
    return NextResponse.redirect(getMarketingUrl('/'));
  }

  // ── 5. Tenant-scoped routes — rewrite internally ───────────────────────
  if (!tenant) {
    return NextResponse.redirect(getMarketingUrl('/'));
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-org-slug', tenant.orgSlug);
  requestHeaders.set('x-site-type', tenant.siteType);

  const internalPrefix = tenant.siteType === 'storefront' ? `/store/${tenant.orgSlug}` : `/${tenant.orgSlug}`;

  // A rewritten request is re-run through Proxy (the rewritten path still
  // matches config.matcher below), so without this check the internal
  // prefix above would be prepended again on the second pass, and again on
  // the third, etc. Once the prefix is already present, this is that
  // second pass — just forward the tenant headers, no further rewrite.
  if (pathname === internalPrefix || pathname.startsWith(`${internalPrefix}/`)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const internalPath =
    tenant.siteType === 'storefront'
      ? `${internalPrefix}${pathname === '/' ? '' : pathname}`
      : `${internalPrefix}${pathname === '/' ? '/dashboard' : pathname}`;

  const rewriteUrl = new URL(`${internalPath}${req.nextUrl.search}`, requestUrl);

  return NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
