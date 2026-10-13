/*
 * lib/tenant/business.ts
 *
 * The business host (b.{ROOT_DOMAIN}, ROADMAP 19.1): the admin for ANY shop
 * on one origin, so the business app — which can only stay on one origin —
 * can run every shop a person belongs to, plus sign-in and onboarding.
 *
 * The shop comes from the session (`currentOrgSlug`, set by
 * switchOrganization), not from the URL. Every admin link is slug-free, so
 * `/inventory` here is rewritten to `/{shop}/inventory` exactly as it is on
 * {shop}.{ROOT_DOMAIN}, and no page, link or action changes.
 *
 * One link names a shop: `/o/{slug}/{path}`. It switches the session to that
 * shop (members only) and lands on `{path}` — for anything that may arrive
 * while the session is in another shop (an alert, an email, the
 * "unavailable" page's list of other shops).
 *
 * `resolveBusinessRoute` is pure (the proxy's decisions, unit-tested);
 * `businessShopFor` reads memberships.
 */
import { prisma } from '@/lib/prisma';

/**
 * Which shop the business host is in, for this browser. Its own cookie, not
 * only the JWT's `currentOrgSlug`: Auth.js re-sends the session cookie on
 * every response, so a request the old page already had in flight (a poll)
 * would set the session back to the old shop moments after a switch. This
 * cookie is written only by a switch (lib/session.ts). It grants nothing —
 * membership is re-checked on every request — so it needn't be secret.
 * Host-only on the business host; the JWT's slug is the fallback.
 */
export const BUSINESS_SHOP_COOKIE = 'mansaas-business-shop';

/** The internal route `/o/{slug}/…` is rewritten to; it does the switch. */
export const BUSINESS_OPEN_PATH = '/business/open';
/** Where a link to a shop the person isn't in lands. */
export const BUSINESS_NO_ACCESS_PATH = '/business/no-access';

/** Open to anyone: signing in and the pages it links to. */
const PUBLIC_PATHS = new Set(['/login', '/register', '/forgot-password', '/reset-password', '/privacy', '/terms']);
const PUBLIC_PREFIXES = ['/invite/', '/verify-email/'];
/** Signed in, but in no shop yet. */
const NO_SHOP_PREFIXES = ['/onboarding', BUSINESS_NO_ACCESS_PATH];
/** Other surfaces' trees, never served here: the console, the storefront, the shopper app. */
const BLOCKED_PREFIXES = ['/platform', '/store', '/s', '/m'];

/** The files phones check to open links in the business app (ROADMAP 19.5), served from BUSINESS_WELL_KNOWN. */
const APP_LINK_FILE = /^\/\.well-known\/(apple-app-site-association|assetlinks\.json)$/;
export const BUSINESS_WELL_KNOWN = '/business/well-known';

/** What a browser fetches to install the site, without cookies (ROADMAP 18.3). */
const INSTALL_FILE = /^\/(manifest\.webmanifest|app-icon\/\d+)$/;
/** …served from here, on the rewritten pass. */
export const BUSINESS_INSTALL_PREFIX = '/business';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

export type BusinessRoute =
  /** serve as-is (sign-in pages, onboarding) */
  | { kind: 'pass' }
  /** signed out on a page that needs a session → /login here */
  | { kind: 'sign-in' }
  /** signed in on /login or /register → the dashboard */
  | { kind: 'home' }
  /** another surface's path → the dashboard */
  | { kind: 'blocked' }
  /** `/o/{slug}/{to}` → switch to that shop and go to `to` */
  | { kind: 'entry'; slug: string; to: string }
  /** the switch itself, on the rewritten pass */
  | { kind: 'open' }
  /** the install files: rewrite under BUSINESS_INSTALL_PREFIX, no session needed */
  | { kind: 'install' }
  /** the phones' link files: rewrite under BUSINESS_WELL_KNOWN, no session needed */
  | { kind: 'app-links' }
  /** an admin page of the session's shop */
  | { kind: 'admin' };

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

/**
 * Where `/o/{slug}/…` may send someone: a path on this host. Anything that
 * could leave it (`//evil`, `/\\evil`) or loop back here becomes the
 * dashboard.
 */
export function safeBusinessPath(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 2048) return '/dashboard';
  if (under(value.split(/[?#]/)[0], '/o') || under(value, BUSINESS_OPEN_PATH)) return '/dashboard';
  return value;
}

export function resolveBusinessRoute(
  pathname: string,
  context: { signedIn: boolean; method: string; search?: string },
): BusinessRoute {
  const isGet = context.method === 'GET' || context.method === 'HEAD';

  if (PUBLIC_PATHS.has(pathname)) {
    // POST stays: a sign-in form's server action posts back to its own page.
    if (context.signedIn && isGet && (pathname === '/login' || pathname === '/register')) return { kind: 'home' };
    return { kind: 'pass' };
  }
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return { kind: 'pass' };
  if (APP_LINK_FILE.test(pathname)) return { kind: 'app-links' };
  if (under(pathname, BUSINESS_WELL_KNOWN)) return { kind: 'pass' };
  if (INSTALL_FILE.test(pathname)) return { kind: 'install' };
  if (pathname.startsWith(BUSINESS_INSTALL_PREFIX) && INSTALL_FILE.test(pathname.slice(BUSINESS_INSTALL_PREFIX.length))) return { kind: 'pass' };

  if (!context.signedIn) return { kind: 'sign-in' };

  if (NO_SHOP_PREFIXES.some((prefix) => under(pathname, prefix))) return { kind: 'pass' };
  if (under(pathname, BUSINESS_OPEN_PATH)) return { kind: 'open' };

  if (under(pathname, '/o')) {
    const [, , slug = '', ...rest] = pathname.split('/');
    if (!SLUG.test(slug)) return { kind: 'blocked' };
    return { kind: 'entry', slug, to: safeBusinessPath(`/${rest.join('/')}${context.search ?? ''}`) };
  }

  if (BLOCKED_PREFIXES.some((prefix) => under(pathname, prefix))) return { kind: 'blocked' };
  return { kind: 'admin' };
}

export interface BusinessShop {
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  /** false: the session's shop is gone or they left it, so this is another of theirs */
  remembered: boolean;
}

/**
 * The shop a business-host request is in: the session's, while the person is
 * still an active member of it and it is open (or suspended, which explains
 * itself — ROADMAP 11.4); otherwise their first active shop, then their first
 * suspended one, as the platform host's `/` picks. Null when they have none.
 *
 * Read fresh on every request, not cached: "removed from this shop a moment
 * ago" is exactly the case that matters.
 */
export async function businessShopFor(userId: string, rememberedSlug: string | null | undefined): Promise<BusinessShop | null> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE', organization: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
    select: { organization: { select: { slug: true, status: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  const shops = memberships.map((m) => ({ slug: m.organization.slug, status: m.organization.status as 'ACTIVE' | 'SUSPENDED' }));

  const remembered = rememberedSlug ? shops.find((shop) => shop.slug === rememberedSlug) : undefined;
  if (remembered) return { ...remembered, remembered: true };

  const fallback = shops.find((shop) => shop.status === 'ACTIVE') ?? shops[0];
  return fallback ? { ...fallback, remembered: false } : null;
}

/** Whether this person may open this shop through `/o/{slug}/…`. */
export async function canOpenShop(userId: string, slug: string): Promise<{ id: string; slug: string } | null> {
  const membership = await prisma.membership.findFirst({
    where: { userId, status: 'ACTIVE', organization: { slug, status: { in: ['ACTIVE', 'SUSPENDED'] } } },
    select: { organization: { select: { id: true, slug: true } } },
  });
  return membership?.organization ?? null;
}
