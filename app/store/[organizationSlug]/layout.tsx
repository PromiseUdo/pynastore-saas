/*
 * app/store/[organizationSlug]/ — storefront root layout.
 *
 * Reached via proxy.ts rewriting shop-{slug}.{ROOT_DOMAIN} (or the mobile
 * origin's /s/{slug}) to /store/{slug}/.... Resolves the tenant, scopes the
 * retail theme (storefront.css, `[data-storefront]`) and mounts the client
 * providers (cart/wishlist/compare stores, toasts). Chrome (header/footer)
 * lives in the (shop) route group so slimline flows (checkout) can opt out.
 */
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Fraunces, Nunito, Playfair_Display } from 'next/font/google';
import { prisma } from '@/lib/prisma';
import { getStoreAppListing } from '@/lib/mobile/listing';
import { StorefrontProviders } from '@/components/storefront/providers';
import { shopperChatStatus } from '@/lib/chat/storefront';
import { pushReadyFor } from '@/lib/mobile/push/watch';
import { webPushConfigured } from '@/lib/notifications/channels/web-push';
import { ablyConfigured } from '@/lib/realtime/ably';
import { StorefrontAnalytics } from '@/components/storefront/layout/storefront-analytics';
import { getRequestDesign, getStorefrontLook } from '@/lib/storefront/catalog';
import { parseTheme, themeCookieName } from '@/lib/storefront/theme';
import { getShopper } from '@/lib/storefront/account/session';
import { listWishlist } from '@/lib/storefront/account/wishlist';
import { getProductsByIds, getStorePages } from '@/lib/storefront/catalog';
import { pageOfKind } from '@/lib/storefront/pages/rules';
import { WishlistSync } from '@/components/storefront/wishlist/wishlist-sync';
import { storefrontIsOpen } from '@/lib/billing/workspace-access';
import { getStorefrontOpening } from '@/lib/storefront/opening';
import { getTradeGate } from '@/lib/storefront/trade-gate';
import { openInTradeOnly } from '@/lib/trade/rules';
import './storefront.css';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';
import { workspaceHasFeature } from '@/lib/billing/workspace-access';
import { FEATURES } from '@/lib/billing/plans';
import { cloudinaryImage } from '@/lib/cloudinary/url';

/*
 * Display face for the storefront only. Fraunces is a variable "soft serif":
 * the `SOFT` and `WONK` axes (set in storefront.css) round its terminals and
 * tilt a few letterforms, which is most of what makes the page feel warm and
 * hand-made rather than corporate. The admin app keeps the Geist sans.
 */
const display = Fraunces({
  subsets: ['latin'],
  // No `weight` — that selects the variable font, which is what makes the
  // extra axes available (next/font rejects `axes` alongside `weight`).
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
  variable: '--font-sf-display',
});

/*
 * The other heading faces a shop's design may choose (ROADMAP 15.1 —
 * lib/storefront/design/looks.ts). Declared here so they're self-hosted like
 * Fraunces, but NOT preloaded: declaring a face only defines it, and the
 * browser downloads one only when a heading actually uses it — so a shop
 * pays for its own font and no other. Fraunces stays preloaded because
 * Classic is what most shops show. Modern uses the app's Geist, already
 * loaded by the root layout.
 */
const elegant = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-sf-elegant',
});
const friendly = Nunito({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-sf-friendly',
});
const fontVariables = `${display.variable} ${elegant.variable} ${friendly.variable}`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}): Promise<Metadata> {
  const { organizationSlug } = await params;
  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: {
      name: true,
      logoUrl: true,
      faviconUrl: true,
      storefrontTagline: true,
      storefrontSocialImageUrl: true,
      storefrontOpen: true,
      wholesaleMode: true,
    },
  });
  if (!org) return {};
  // Safari's own "Get the app" banner, once the store's app is in the App Store (ROADMAP 16.4).
  const appListing = await getStoreAppListing({ organizationSlug });
  // Not open yet (12.5): the "Opening soon" page stays out of search results.
  if (!org.storefrontOpen) return { title: org.name, robots: { index: false, follow: false } };
  // Trade only (ROADMAP 21.1): nothing here is for the public, so nothing is listed.
  if (org.wholesaleMode === 'TRADE_ONLY') return { title: org.name, robots: { index: false, follow: false } };

  /* The merchant's own line if they have written one. No claims about what
   * the store sells or how it delivers: those were template words ("free
   * 30-day returns") this app never enforced, appearing in every merchant's
   * search listing. Pages that know more set their own. */
  const description = org.storefrontTagline?.trim() || `Shop online at ${org.name}.`;
  const image = org.storefrontSocialImageUrl ?? org.logoUrl ?? null;
  /* The browser-tab icon: the merchant's own favicon if they set one, else
   * the logo (15.0), shrunk by Cloudinary rather than downloaded at full
   * size. Setting `icons` here replaces the platform's (app/layout.tsx), so
   * the shop's is the only one on the page. With neither, the browser falls
   * back to /favicon.ico. */
  const tabIcon = org.faviconUrl ?? org.logoUrl;
  const icons = tabIcon
    ? { icon: [{ url: cloudinaryImage(tabIcon, { width: 64, height: 64, crop: 'fit' }), sizes: '64x64' }], apple: '/app-icon/180' }
    : { apple: '/app-icon/180' };

  return {
    metadataBase: new URL((await storefrontUrlFor(organizationSlug))),
    title: { default: `${org.name} — Online Store`, template: `%s · ${org.name}` },
    description,
    alternates: { canonical: '/' },
    ...(appListing?.appStoreId ? { itunes: { appId: appListing.appStoreId } } : {}),
    icons,
    /* Installable to a Home Screen under the shop's own name and icon
     * (ROADMAP 18.3) — which is also what lets an iPhone get its notifications. */
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: org.name, statusBarStyle: 'default' },
    openGraph: {
      type: 'website',
      siteName: org.name,
      title: org.name,
      description,
      url: (await storefrontUrlFor(organizationSlug)),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: org.name,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function StorefrontRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  const organization = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      logoDarkUrl: true,
      status: true,
      storefrontChatEnabled: true,
      storefrontChatGreeting: true,
    },
  });
  if (!organization) notFound();

  /* Three ways a shop is closed, each shown as a page — not an error, not a
   * 404 — and each refusing orders (placeOrder checks too). In this order:
   * - suspended by platform staff (ROADMAP 11.4). proxy.ts sends every
   *   request for a suspended shop here, to the root, so nothing else runs.
   *   The shopper isn't told why; that's between the platform and merchant.
   * - the merchant's plan ended and grace ran out (12.1). It reopens the
   *   moment they pay.
   * - not open yet (12.5): "Opening soon", until the merchant opens it from
   *   the setup guide. Their own team sees the real shop with a preview
   *   banner instead. */
  const suspended = organization.status === 'SUSPENDED';
  // Asked together: neither answer depends on the other.
  const [openOnPlan, opening] = await Promise.all([
    suspended ? false : storefrontIsOpen(organization.id),
    getStorefrontOpening(organization.slug),
  ]);
  const lapsed = !suspended && !openOnPlan;
  const notOpen = !suspended && !lapsed && !opening.open && !opening.previewer;
  if (suspended || lapsed || notOpen) {
    return (
      <div
        data-storefront
        className={`${fontVariables} flex min-h-screen items-center justify-center bg-background px-4 text-foreground`}
      >
        <main className="max-w-md text-center">
          {organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt="" className="mx-auto mb-5 h-12 w-auto object-contain" />
          ) : null}
          <h1 className="font-display text-3xl">
            {suspended
              ? `${organization.name} is unavailable`
              : notOpen && !opening.everOpened
                ? `${organization.name} is opening soon`
                : `${organization.name} is closed for now`}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {suspended
              ? 'This shop isn’t available at the moment, so it can’t take orders.'
              : notOpen && !opening.everOpened
                ? 'This shop isn’t open yet. Please check back soon.'
                : 'This shop isn’t taking orders at the moment. Please check back soon.'}
          </p>
        </main>
      </div>
    );
  }

  /* Trade only (ROADMAP 21.1): anyone who isn't an approved trade buyer or
   * on the team sees what this shop is and how to get in, instead of a shop
   * with nothing in it. Signing in, their account (where they ask) and the
   * merchant's own pages stay open (lib/trade/rules.ts). The catalogue is
   * empty for them regardless (lib/storefront/trade-gate.ts).
   * The AI shopping assistant and search by photo (ROADMAP 22.1) is asked
   * at the same time — independent reads, so one round trip, not three. */
  const [requestHeaders, tradeGate, aiShopping] = await Promise.all([
    headers(),
    getTradeGate(organization.slug),
    workspaceHasFeature(organization.id, FEATURES.AI_SHOPPING),
  ]);
  if (tradeGate.tradeOnly && !tradeGate.allowed && !openInTradeOnly(requestHeaders.get('x-store-path'))) {
    const button =
      'inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] px-6 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
    return (
      <div
        data-storefront
        className={`${fontVariables} flex min-h-screen items-center justify-center bg-background px-4 text-foreground`}
      >
        <main className="max-w-md text-center">
          {organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt="" className="mx-auto mb-5 h-12 w-auto object-contain" />
          ) : null}
          <h1 className="font-display text-3xl">{organization.name} sells to businesses</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Products and prices are for approved trade buyers. Sign in if you have a trade account, or find out how to get one.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href="/account/sign-in" className={`${button} bg-brand text-primary-foreground hover:opacity-90`}>
              Sign in
            </a>
            <a href="/wholesale" className={`${button} border border-border hover:border-brand hover:text-brand`}>
              Buy wholesale
            </a>
          </div>
        </main>
      </div>
    );
  }

  const isMobileRuntime = requestHeaders.get('x-runtime') === 'mobile';
  // The request's CSP nonce (proxy.ts), for the merchant's measurement tags.
  const nonce = requestHeaders.get('x-nonce') ?? undefined;

  /* Messages (ROADMAP 17.3): shown only when the merchant has turned it on
   * AND the shop is really open — a team member previewing a closed shop
   * gets no chat, since nothing they sent could be answered. The status
   * (does this browser have a conversation, anything unread) is read only
   * when chat is on, and only finds anything for someone who has written. */
  const chatOn = organization.storefrontChatEnabled && opening.open;

  /* Everything else this frame needs, asked at once — each is an
   * independent read, so the page waits for the slowest, not the sum. */
  const [{ shopper, savedItems }, chatStatus, appPush, storePages, look, cookieStore, { resolved: design, isDraft }] =
    await Promise.all([
      /* Resolved here, once, for every storefront surface — including
       * checkout, which sits outside the (shop) group. Null when nobody is
       * signed in; nothing below this point may require it. With them, the
       * account's saved list, so the browser copy can be reconciled with it
       * on every load (see <WishlistSync />). Slugs come from the catalogue
       * because a saved id has to become a link. */
      (async () => {
        const shopper = await getShopper();
        if (!shopper) return { shopper, savedItems: [] as { productId: string; slug: string }[] };
        const ids = await listWishlist({ organizationId: shopper.organizationId, customerId: shopper.id });
        const products = ids.length ? await getProductsByIds(ids, { organizationSlug: organization.slug }) : [];
        const bySlug = new Map(products.map((product) => [product.id, product.slug]));
        return {
          shopper,
          savedItems: ids.filter((id) => bySlug.has(id)).map((id) => ({ productId: id, slug: bySlug.get(id)! })),
        };
      })(),
      chatOn ? shopperChatStatus({ slug: organization.slug, organizationId: organization.id }) : null,
      // Replies reach the store's own app (ROADMAP 17.4)…
      chatOn && isMobileRuntime ? pushReadyFor(requestHeaders.get('user-agent'), organization.slug) : false,
      getStorePages({ organizationSlug: organization.slug }),
      getStorefrontLook({ organizationSlug: organization.slug }),
      cookies(),
      /* The shop's design (15.1). A member previewing their draft carries a
       * signed preview cookie; it is honoured only after re-checking, now,
       * that they're still on this shop's team with `storefront.design`.
       * Everyone else — including anyone holding a stale or foreign cookie —
       * gets the published design. The homepage reads the same decision for
       * its sections. */
      getRequestDesign({ organizationSlug: organization.slug }),
    ]);

  const chat =
    chatOn && chatStatus
      ? {
          greeting: organization.storefrontChatGreeting,
          ...chatStatus,
          // …or a browser on the website (18.3).
          push: isMobileRuntime ? (appPush ? ('app' as const) : null) : webPushConfigured() ? ('browser' as const) : null,
          realtime: ablyConfigured(),
        }
      : null;

  const privacyPage = pageOfKind(storePages, 'PRIVACY');

  // Theme is server-rendered from a cookie — see lib/storefront/theme.ts. The
  // shopper's own choice wins; without one, the design's default.
  // Cream (light) is represented by the absence of the attribute.
  const theme = parseTheme(
    cookieStore.get(themeCookieName(organization.slug))?.value,
    design.darkByDefault ? 'dark' : 'light',
  );

  return (
    <div
      data-storefront
      data-sf-theme={theme === 'dark' ? 'dark' : undefined}
      /* The look, corners, headings font and card style (storefront.css),
       * and the merchant's brand colour as the `--merchant-brand*` tokens the
       * palettes fall back from. Every value is from a fixed list or a
       * checked colour — lib/storefront/design/tokens.ts. */
      {...design.attributes}
      style={Object.keys(design.style).length ? (design.style as React.CSSProperties) : undefined}
      /* pt: the page starts below the phone's status bar. 0 everywhere but an
       * app drawn edge to edge (globals.css, --inset-top). */
      className={`${fontVariables} min-h-screen bg-background pt-[var(--inset-top)] text-foreground`}
    >
      {/* Behind the status bar's clock and icons, in the shop's own
        * background, so content scrolling up never shows through them. Has no
        * height anywhere the status bar isn't drawn over the page. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[var(--inset-top)] bg-background" />
      {/* Not inside the mobile app (13.9): a merchant's Google Analytics or Meta
          Pixel there is "tracking" under Apple's rules, which the app would have
          to ask permission for and declare. The website keeps them. */}
      {!isMobileRuntime && (
        <StorefrontAnalytics gaId={look.analytics.gaId} metaPixelId={look.analytics.metaPixelId} nonce={nonce} />
      )}
      <StorefrontProviders
        org={{ slug: organization.slug, name: organization.name, logoUrl: organization.logoUrl, logoDarkUrl: organization.logoDarkUrl, aiShopping }}
        isMobileRuntime={isMobileRuntime}
        privacyHref={privacyPage?.href ?? null}
        chat={chat}
        shopper={
          shopper
            ? {
                id: shopper.id,
                name: shopper.name,
                firstName: shopper.firstName,
                email: shopper.email,
              }
            : null
        }
      >
        <WishlistSync serverItems={savedItems} />
        {isDraft && (
          <div
            role="status"
            className="sticky top-[var(--inset-top)] z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-foreground px-4 py-2 text-center text-xs text-background"
          >
            <span>Draft preview — only you can see this look. Shoppers still see your published one.</span>
            {/* A plain link: leaving needs a request so the cookie can be cleared. */}
            <a href="/design-preview?exit=1" className="font-semibold underline underline-offset-2">
              Exit preview
            </a>
          </div>
        )}
        {!opening.open && (
          <div role="status" className="sticky top-[var(--inset-top)] z-50 bg-foreground px-4 py-2 text-center text-xs text-background">
            Preview — your shop is closed, so only your team can see this and nothing can be ordered. Open it from
            Setup guide in your dashboard menu.
          </div>
        )}
        {children}
      </StorefrontProviders>
    </div>
  );
}
