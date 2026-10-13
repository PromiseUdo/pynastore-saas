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
 *   {ROOT_DOMAIN}, www.        -> marketing
 *   {PLATFORM_HOST}            -> marketing (auth pages, home gate). In
 *                                 production its own host, app.{ROOT_DOMAIN};
 *                                 in local dev the root domain itself.
 *   {slug}.{ROOT_DOMAIN}       -> admin, internally rewritten to /${slug}/...
 *   shop-{slug}.{ROOT_DOMAIN}  -> storefront, rewritten to /store/${slug}/...
 *   b.{ROOT_DOMAIN}            -> business: the admin of the SESSION's shop,
 *                                 rewritten to /${slug}/... (ROADMAP 19)
 *   a registered custom domain -> resolved via DB (see resolveTenant.ts)
 *
 * The public URL never shows the org slug — see lib/tenant/resolveHostname.ts
 * and lib/tenant/resolveTenant.ts for the resolution logic.
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { authConfig } from '@/auth.config';
import { APP_UNAVAILABLE_PATH, resolveMobileRoute } from '@/lib/mobile/app-config';
import { mobileAppForUserAgent } from '@/lib/mobile/store-apps';
import { prisma } from '@/lib/prisma';
import { BUSINESS_INSTALL_PREFIX, BUSINESS_OPEN_PATH, BUSINESS_SHOP_COOKIE, BUSINESS_WELL_KNOWN, businessShopFor, resolveBusinessRoute } from '@/lib/tenant/business';
import { getRootDomain, resolveHostname, isLocalHostname } from '@/lib/tenant/resolveHostname';
import { resolveTenant, resolveTenantBySlug } from '@/lib/tenant/resolveTenant';
import { getOrgRouting } from '@/lib/tenant/org-status';
import { getAdminUrl, getBusinessUrl, getMarketingUrl, getStorefrontUrl } from '@/lib/tenant/urls';
import { buildCsp, cspMode, makeNonce } from '@/lib/security/csp';
import { PREVIEW_COOKIE } from '@/lib/storefront/design/preview-cookie';

/*
 * A design-preview request on a shop's PLATFORM address (ROADMAP 15.3): the
 * link from Online store → Customize, or a page carrying the preview cookie
 * it sets. Only on the platform address — that is where the admin's
 * side-by-side preview frame points, because the admin's own session and
 * the frame rules both work there. The cookie grants nothing by itself; the
 * storefront re-checks the member on every page.
 */
function isDesignPreview(req: NextRequest, hostInfo: { siteType: string; isCustomDomain: boolean }): boolean {
  if (hostInfo.siteType !== 'storefront' || hostInfo.isCustomDomain) return false;
  // The proxy also sees its own rewrite (/store/{slug}/design-preview) on a second pass.
  return PREVIEW_PATH.test(req.nextUrl.pathname) || req.cookies.has(PREVIEW_COOKIE);
}
const PREVIEW_PATH = /^(\/store\/[^/]+)?\/design-preview$/;

const { auth } = NextAuth(authConfig);

/* Routes that need no session at all — exact matches. Only meaningful on
 * the marketing domain; there is nothing at these paths on a tenant
 * subdomain.
 *
 * /privacy and /terms are the platform's public legal pages
 * (app/(legal)/...). They must load for anyone, signed in or not — a Meta
 * App Review reviewer opens https://getnotely.io/privacy in a private
 * window — so they belong here and nowhere else: as marketing-host paths
 * they never become tenant routes. */
const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/privacy',
  '/terms',
  // The public site's pricing (ROADMAP 12.3). `/` above is the landing page.
  '/pricing',
]);

/* Route prefixes that are fully public (no auth required to load). */
const PUBLIC_PREFIXES = ['/invite', '/verify-email'];

/* Routes that need a session but no tenant. `/platform` is the platform
 * console (ROADMAP 11): the session is checked here, and whether the user is
 * platform staff is checked by the console itself (lib/platform-staff.ts). */
const AUTH_ONLY_PREFIXES = ['/onboarding', '/platform'];

/* What a browser fetches to install a site as an app (ROADMAP 18.3): the
 * manifest and its icons, for the admin (/…), the console (/platform/…) and
 * a store. Browsers fetch them WITHOUT cookies, so they must load without a
 * session; none of them says anything about a shop beyond its public name.
 * (The service worker, /sw.js, is a static file the matcher skips.) */
// One leading segment allowed: /platform, and the admin's internal /{slug}
// on the rewritten second pass through here.
const INSTALL_ASSET = /^(\/[^/]+)?\/(manifest\.webmanifest|app-icon\/\d+)$/;

/* The files that let a store's own app open its links (ROADMAP 18.5). Apple
 * and Google fetch them at exactly the host they're checking and follow no
 * redirect, so they skip the 12.6 canonical redirects and are served on the
 * apex, www and the platform address alike — from app/store/[slug]/well-known. */
const APP_LINK_FILE = /^\/\.well-known\/(apple-app-site-association|assetlinks\.json)$/;

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

const routeRequest = auth(async function proxy(req: NextRequest & { auth: any }) {
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
      // The workspace the session remembers may have been closed since (13.8);
      // sending them back to it would bounce straight back here, forever. Read
      // fresh, not through getOrgRouting's cache: this proxy bundle keeps its
      // own copy of that cache, which the closing action can't clear, and
      // "closed a moment ago" is exactly the case that matters here.
      if (orgSlug) {
        const remembered = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { status: true } });
        if (remembered?.status !== 'ACTIVE' && remembered?.status !== 'SUSPENDED') orgSlug = undefined;
      }
      if (!orgSlug) {
        // An active workspace first; failing that a suspended one, which
        // explains itself — never onboarding, which would start a new shop.
        const memberships = await prisma.membership.findMany({
          where: { userId: session.user.id, status: 'ACTIVE', organization: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
          select: { organization: { select: { slug: true, status: true } } },
          orderBy: { joinedAt: 'asc' },
        });
        orgSlug = (memberships.find((m) => m.organization.status === 'ACTIVE') ?? memberships[0])?.organization.slug;
      }
      return NextResponse.redirect(orgSlug ? getAdminUrl(orgSlug, '/dashboard') : getMarketingUrl('/onboarding'));
    }

    return NextResponse.next({ request: { headers: new Headers(req.headers) } });
  }

  // ── 1b. Public prefixes — fully accessible without a session ─────────────
  //        /invite/[token] is public: the page itself handles the auth split.
  if (isMarketing && PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers: new Headers(req.headers) } });
  }

  // ── 1c. Mobile origin — the Capacitor app's single server host ──────────
  //        Serves ONLY the customer storefront. The org slug travels in the
  //        path as /s/{slug}/... (there is no per-tenant subdomain here).
  //        Every admin/dashboard/marketing path is blocked → store picker.
  //        Runs BEFORE the auth gate: storefront browsing is public.
  //
  //        Which app is asking — the shared one (mall), a store's own app
  //        (locked to that store), or a lapsed one — comes from the app's
  //        user-agent marker (lib/mobile/app-config.ts, ROADMAP 16.1).
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

    const app = await mobileAppForUserAgent(req.headers.get('user-agent'));
    const route = resolveMobileRoute(pathname, app);

    const unavailable = (slug: string | null) => {
      const url = new URL(APP_UNAVAILABLE_PATH, requestUrl);
      if (slug) url.searchParams.set('store', slug);
      return NextResponse.rewrite(url, { request: { headers: new Headers(req.headers) } });
    };

    if (route.kind === 'mpath') return NextResponse.next({ request: { headers: new Headers(req.headers) } });
    if (route.kind === 'picker') return NextResponse.rewrite(new URL('/m', requestUrl), { request: { headers: new Headers(req.headers) } });
    if (route.kind === 'unavailable') return unavailable(route.slug);
    if (route.kind === 'home') return NextResponse.redirect(mobileHome);

    const tenant = await resolveTenantBySlug(route.slug);
    if (!tenant) {
      // Unknown slug. A store's own app whose store is gone has nothing
      // else to show; in the shared app the picker is the error surface.
      if (app.mode === 'branded') return unavailable(null);
      return NextResponse.rewrite(new URL('/m', requestUrl), { request: { headers: new Headers(req.headers) } });
    }

    // A suspended shop opens only its "unavailable" page (ROADMAP 11.4).
    const rest = tenant.status === 'SUSPENDED' ? '' : route.rest;
    const headers = stampStorefront(tenant.orgSlug);
    headers.set('x-store-path', `${rest || '/'}${req.nextUrl.search}`);
    const rewriteUrl = new URL(`/store/${tenant.orgSlug}${rest}${tenant.status === 'SUSPENDED' ? '' : req.nextUrl.search}`, requestUrl);
    return NextResponse.rewrite(rewriteUrl, { request: { headers } });
  }

  // ── 1d. Business host — the admin for ANY shop on one origin (ROADMAP 19)
  //        The shop is the session's (lib/tenant/business.ts), so the
  //        admin's slug-free paths rewrite to /{shop}/… exactly as on
  //        {shop}.{ROOT_DOMAIN}. Sign-in and onboarding are served here too,
  //        and every redirect stays on this host — the business app can't
  //        follow one off it.
  if (hostInfo.siteType === 'business') {
    const here = (path: string) => new URL(path, requestUrl);
    const passThrough = () => NextResponse.next({ request: { headers: new Headers(req.headers) } });
    const userId: string | undefined = session?.user?.id;
    const route = resolveBusinessRoute(pathname, { signedIn: Boolean(userId), method: req.method, search: req.nextUrl.search });

    switch (route.kind) {
      case 'pass':
      case 'open':
        return passThrough();
      case 'sign-in': {
        const loginUrl = here('/login');
        if (pathname !== '/') loginUrl.searchParams.set('callbackUrl', requestUrl);
        return NextResponse.redirect(loginUrl);
      }
      case 'home':
      case 'blocked':
        return NextResponse.redirect(here('/'));
      case 'app-links':
        return NextResponse.rewrite(here(`${BUSINESS_WELL_KNOWN}/${pathname.slice('/.well-known/'.length)}`), { request: { headers: new Headers(req.headers) } });
      case 'install':
        return NextResponse.rewrite(here(`${BUSINESS_INSTALL_PREFIX}${pathname}`), { request: { headers: new Headers(req.headers) } });
      case 'entry': {
        const open = here(`${BUSINESS_OPEN_PATH}/${route.slug}`);
        open.searchParams.set('to', route.to);
        return NextResponse.rewrite(open, { request: { headers: new Headers(req.headers) } });
      }
    }

    // This browser's shop on this host, falling back to the session's (see BUSINESS_SHOP_COOKIE).
    const rememberedSlug: string | undefined = req.cookies.get(BUSINESS_SHOP_COOKIE)?.value || session.currentOrgSlug;
    const shop = await businessShopFor(userId!, rememberedSlug);
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    if (!shop) {
      // In no shop at all: make one (or, from a POST, let the page's own
      // membership check answer — a redirect would replay the action).
      if (isGet) return NextResponse.redirect(here('/onboarding'));
      return passThrough();
    }
    if (!shop.remembered && isGet) {
      // The session's shop is gone or they left it: move the session to one
      // of theirs (only a route handler can write it) and come back here.
      return NextResponse.redirect(here(`/o/${shop.slug}${pathname === '/' ? '' : pathname}${req.nextUrl.search}`));
    }
    // A POST from a page of a shop they're no longer in still names that
    // shop, so the action's own membership check refuses it — it must never
    // run against a different shop than the page it came from.
    const slug = shop.remembered ? shop.slug : rememberedSlug ?? shop.slug;

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-org-slug', slug);
    requestHeaders.set('x-site-type', 'admin');
    const internalPrefix = `/${slug}`;

    if (shop.remembered && shop.status === 'SUSPENDED') {
      if (pathname === '/unavailable/workspace') return NextResponse.next({ request: { headers: requestHeaders } });
      return NextResponse.rewrite(here('/unavailable/workspace'), { request: { headers: requestHeaders } });
    }

    const alreadyRewritten = pathname === internalPrefix || pathname.startsWith(`${internalPrefix}/`);
    requestHeaders.set('x-admin-path', alreadyRewritten ? pathname.slice(internalPrefix.length) || '/' : pathname);
    if (alreadyRewritten) return NextResponse.next({ request: { headers: requestHeaders } });

    const internalPath = `${internalPrefix}${pathname === '/' ? '/dashboard' : pathname}`;
    return NextResponse.rewrite(here(`${internalPath}${req.nextUrl.search}`), { request: { headers: requestHeaders } });
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
  if (needsSession && !session?.user?.id && !INSTALL_ASSET.test(pathname)) {
    const loginUrl = new URL(getMarketingUrl('/login'));
    loginUrl.searchParams.set('callbackUrl', requestUrl);
    return NextResponse.redirect(loginUrl);
  }

  // ── 3b. Auth-only routes (no tenant required) — marketing domain only ───
  if (isMarketing && AUTH_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers: new Headers(req.headers) } });
  }

  // ── 4. Marketing domain has no tenant-scoped content beyond the above ───
  if (isMarketing) {
    if (pathname === '/') return NextResponse.next({ request: { headers: new Headers(req.headers) } });
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

  // ── 5a. Suspension (ROADMAP 11.4) — enforced here, for every page, action
  //        and data request, rather than page by page. A suspended admin
  //        opens only the page saying so; a suspended storefront renders
  //        only its root, where the layout says it's unavailable. Every
  //        other request — a server action included — lands on that page
  //        instead, so nothing else runs. A deleted workspace is gone.
  // ── 5b. The shop's own domain (ROADMAP 12.6). The bare domain goes to its
  //        www (canonical), and the platform's shop-{slug} address goes to
  //        the live custom domain — permanently, so saved links keep working
  //        and search engines see one shop. The mobile origin never leaves
  //        its single host, so it isn't redirected.
  if (tenant.siteType === 'storefront' && APP_LINK_FILE.test(pathname)) {
    const rewrite = new URL(`${internalPrefix}/well-known/${pathname.slice('/.well-known/'.length)}`, requestUrl);
    return NextResponse.rewrite(rewrite, { request: { headers: requestHeaders } });
  }
  // …and its second pass through here, under the internal path, isn't redirected either.
  if (tenant.siteType === 'storefront' && pathname.startsWith(`${internalPrefix}/well-known/`)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (tenant.redirectHost) {
    return NextResponse.redirect(`https://${tenant.redirectHost}${pathname}${req.nextUrl.search}`, 308);
  }
  const routing = tenant.status ? null : await getOrgRouting(tenant.orgSlug);
  /* …except a design preview, which stays on the platform address so it can
   * sit inside the admin's preview frame (15.3). Only a browser that opened
   * a preview has the cookie; search engines never see the exception. */
  if (
    tenant.siteType === 'storefront' &&
    !hostInfo.isCustomDomain &&
    routing?.customStoreDomain &&
    !isDesignPreview(req, hostInfo)
  ) {
    const publicPath = pathname === internalPrefix || pathname.startsWith(`${internalPrefix}/`) ? pathname.slice(internalPrefix.length) || '/' : pathname;
    return NextResponse.redirect(`https://${routing.customStoreDomain}${publicPath}${req.nextUrl.search}`, 308);
  }

  const status = tenant.status ?? routing?.status ?? null;
  if (status === 'DELETED') {
    return NextResponse.redirect(getMarketingUrl('/'));
  }
  if (status === 'SUSPENDED') {
    if (tenant.siteType === 'admin') {
      if (pathname === '/unavailable/workspace') return NextResponse.next({ request: { headers: requestHeaders } });
      return NextResponse.rewrite(new URL('/unavailable/workspace', requestUrl), { request: { headers: requestHeaders } });
    }
    if (pathname === internalPrefix) return NextResponse.next({ request: { headers: requestHeaders } });
    return NextResponse.rewrite(new URL(internalPrefix, requestUrl), { request: { headers: requestHeaders } });
  }

  /* The admin page being opened, as the merchant sees it (/settings/billing),
   * for the dashboard layout: a lapsed workspace opens only billing and the
   * orders already placed (ROADMAP 12.1). Set by the proxy, never trusted from
   * the browser — an incoming header of the same name is overwritten. */
  /* The storefront page being opened, as the shopper sees it (/account/orders/R-1?x=y),
   * for the account pages' sign-in to come back to (ROADMAP 18.5). Set here,
   * never trusted from the browser — an incoming header of the same name is
   * overwritten. */
  if (tenant.siteType === 'storefront') {
    const storePath = pathname === internalPrefix || pathname.startsWith(`${internalPrefix}/`) ? pathname.slice(internalPrefix.length) || '/' : pathname;
    requestHeaders.set('x-store-path', `${storePath}${req.nextUrl.search}`);
  }
  if (tenant.siteType === 'admin') {
    const adminPath =
      pathname === internalPrefix || pathname.startsWith(`${internalPrefix}/`)
        ? pathname.slice(internalPrefix.length) || '/'
        : pathname;
    requestHeaders.set('x-admin-path', adminPath);
  }

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

/*
 * Every page gets a Content Security Policy with a fresh nonce (ROADMAP
 * 13.4, lib/security/csp.ts). The nonce rides on the REQUEST headers so
 * Next.js can stamp its own scripts with it while rendering — which is why
 * every pass-through above forwards `req.headers` rather than calling a bare
 * NextResponse.next() — and the policy goes on the response. Redirects carry
 * it too; it does nothing there, and there's no reason to special-case them.
 */
/*
 * Next.js answers a server action's redirect by fetching the target page from
 * itself. Under `next dev` / `next start` it fetches from its own address
 * (__NEXT_PRIVATE_ORIGIN, e.g. http://localhost:3000), and Node's fetch
 * replaces the Host header with that — so without this, a storefront
 * "Sign in" that redirects to /account rendered the PLATFORM's home page
 * under the shop's address. The original host still travels in
 * x-forwarded-host, so a request whose Host is this machine's own loopback
 * address takes it from there. Only ever true for such internal fetches: no
 * real visitor reaches a tenant as bare "localhost", and on Vercel the Host
 * is never a loopback address.
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
function restoreForwardedHost(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (LOOPBACK.test(host) && forwarded && !LOOPBACK.test(forwarded)) req.headers.set('host', forwarded);
}

export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  restoreForwardedHost(req);
  const mode = cspMode();
  if (mode === 'off') return routeRequest(req, event as never);

  const hostInfo = resolveHostname(req.headers.get('host'));
  const nonce = makeNonce();
  const slug = hostInfo.isCustomDomain ? null : hostInfo.subdomain;
  const policy = buildCsp({
    nonce,
    storefront: hostInfo.siteType === 'storefront' || hostInfo.siteType === 'mobile' || hostInfo.isCustomDomain,
    dev: process.env.NODE_ENV === 'development',
    https: req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:',
    // A shop's admin may frame its own storefront — the designer's preview (15.3).
    // The business host's shop is the session's, unknown here, so it may
    // frame the platform's own hosts; the storefront still re-checks the member.
    frameSrc:
      hostInfo.siteType === 'admin' && slug
        ? [new URL(getStorefrontUrl(slug)).origin]
        : hostInfo.siteType === 'business'
          ? [`${new URL(getBusinessUrl()).protocol}//*.${getRootDomain()}`]
          : undefined,
    // …and that storefront, only mid-preview, may be framed by that admin (or
    // the business host, ROADMAP 19) and nothing else.
    frameAncestors: slug && isDesignPreview(req, hostInfo) ? [new URL(getAdminUrl(slug)).origin, new URL(getBusinessUrl()).origin] : undefined,
    // The chat's real-time hints (lib/chat/ably.ts) — only when configured.
    realtime: Boolean(process.env.ABLY_API_KEY),
  });
  req.headers.set('x-nonce', nonce);
  req.headers.set('content-security-policy', policy);

  const response = (await routeRequest(req, event as never)) as Response | undefined;
  const res = response ?? NextResponse.next({ request: { headers: new Headers(req.headers) } });
  res.headers.set(mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', policy);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw\\.js$|.*\\.svg$).*)'],
};
