/*
 * app/store/[organizationSlug]/ — storefront root layout.
 *
 * Reached via proxy.ts rewriting shop.{slug}.{ROOT_DOMAIN} (or the mobile
 * origin's /s/{slug}) to /store/{slug}/.... Resolves the tenant, scopes the
 * retail theme (storefront.css, `[data-storefront]`) and mounts the client
 * providers (cart/wishlist/compare stores, toasts). Chrome (header/footer)
 * lives in the (shop) route group so slimline flows (checkout) can opt out.
 */
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Fraunces } from 'next/font/google';
import { prisma } from '@/lib/prisma';
import { StorefrontProviders } from '@/components/storefront/providers';
import { parseTheme, themeCookieName } from '@/lib/storefront/theme';
import { getShopper } from '@/lib/storefront/account/session';
import { listWishlist } from '@/lib/storefront/account/wishlist';
import { getProductsByIds, getStorePages } from '@/lib/storefront/catalog';
import { pageOfKind } from '@/lib/storefront/pages/rules';
import { WishlistSync } from '@/components/storefront/wishlist/wishlist-sync';
import './storefront.css';

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}): Promise<Metadata> {
  const { organizationSlug } = await params;
  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { name: true },
  });
  if (!org) return {};
  /* No claims about what the store sells or how it delivers: those were
   * template words ("free 30-day returns") this app never enforced, in every
   * merchant's search listing. Pages that know more set their own. */
  return {
    title: { default: `${org.name} — Online Store`, template: `%s · ${org.name}` },
    description: `Shop online at ${org.name}.`,
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
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { id: true, name: true, slug: true, logoUrl: true },
  });
  if (!organization) notFound();

  const isMobileRuntime = (await headers()).get('x-runtime') === 'mobile';

  /* Resolved here, once, for every storefront surface — including checkout,
   * which sits outside the (shop) group. Null when nobody is signed in;
   * nothing below this point may require it. */
  const shopper = await getShopper();

  /* The account's saved list, resolved here so the browser copy can be
   * reconciled with it on every load (see <WishlistSync />). Slugs come from
   * the catalogue because a saved id has to become a link. */
  let savedItems: { productId: string; slug: string }[] = [];
  if (shopper) {
    const ids = await listWishlist({
      organizationId: shopper.organizationId,
      customerId: shopper.id,
    });
    const products = ids.length
      ? await getProductsByIds(ids, { organizationSlug: organization.slug })
      : [];
    const bySlug = new Map(products.map((product) => [product.id, product.slug]));
    savedItems = ids
      .filter((id) => bySlug.has(id))
      .map((id) => ({ productId: id, slug: bySlug.get(id)! }));
  }

  // Theme is server-rendered from a cookie — see lib/storefront/theme.ts.
  // Cream (light) is the default, so only 'dark' needs an attribute.
  const theme = parseTheme((await cookies()).get(themeCookieName(organization.slug))?.value);

  const privacyPage = pageOfKind(await getStorePages({ organizationSlug: organization.slug }), 'PRIVACY');

  return (
    <div
      data-storefront
      data-sf-theme={theme === 'dark' ? 'dark' : undefined}
      className={`${display.variable} min-h-screen bg-background text-foreground`}
    >
      <StorefrontProviders
        org={{ slug: organization.slug, name: organization.name, logoUrl: organization.logoUrl }}
        isMobileRuntime={isMobileRuntime}
        privacyHref={privacyPage?.href ?? null}
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
        {children}
      </StorefrontProviders>
    </div>
  );
}
