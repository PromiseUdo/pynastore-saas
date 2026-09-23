/*
 * (shop) route group — the storefront with full chrome (utility bar, header +
 * category nav, footer, and the mobile tab bar on the native origin).
 * Slimline flows like checkout live outside this group.
 *
 * There is deliberately no floating cart pill: the header is sticky and
 * already carries the bag with its count, so a second fixed one added nothing
 * and sat on top of whatever section CTA was in view.
 */
import { UtilityBar } from '@/components/storefront/layout/utility-bar';
import { SiteHeader } from '@/components/storefront/layout/site-header';
import { SiteFooter } from '@/components/storefront/layout/site-footer';
import { MobileTabBar } from '@/components/storefront/layout/mobile-tab-bar';
import { getNavItems, categoryHref } from '@/lib/storefront/navigation';
import {
  getCampaignAnnouncements,
  getDeliveryPromise,
  getFeaturedCategories,
  getStorePages,
  getStorefrontLook,
} from '@/lib/storefront/catalog';
import { CampaignBar } from '@/components/storefront/marketing/campaign-bar';
import { CampaignModal } from '@/components/storefront/marketing/campaign-modal';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { deliveryHeadline, paymentHeadline } from '@/lib/storefront/store-claims';
import { footerPageLinks } from '@/lib/storefront/pages/rules';
import type { FooterColumn } from '@/components/storefront/layout/site-footer';

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const [navItems, departments, pages, delivery, checkout, announcements, look] = await Promise.all([
    getNavItems({ organizationSlug }),
    getFeaturedCategories({ organizationSlug }),
    getStorePages({ organizationSlug }),
    getDeliveryPromise({ organizationSlug }),
    getStoreCheckoutConfig({ organizationSlug }),
    getCampaignAnnouncements({ organizationSlug }),
    getStorefrontLook({ organizationSlug }),
  ]);

  /* At most one of each, newest campaign first: two bars stacked above the
   * header is a worse announcement than one, and two modals in a row is an
   * obstacle course. A merchant running several sales at once still gets to
   * say the most recent thing. */
  const bar = announcements.find((a) => a.style === 'BAR') ?? null;
  const modal = announcements.find((a) => a.style === 'MODAL') ?? null;
  const pageLinks = footerPageLinks(pages);

  /* The footer links to this merchant's own departments, and to pages that
   * exist. Anything without a real destination is simply not offered — see
   * the note in components/storefront/layout/site-footer.tsx. The Help and
   * About columns are the merchant's published store pages, and appear only
   * when there is at least one to put in them. */
  const footerColumns: FooterColumn[] = [
    {
      title: 'Shop',
      links: [
        { label: 'All products', href: '/products' },
        { label: 'Collections', href: '/collections' },
        ...departments.slice(0, 4).map((category) => ({
          label: category.name,
          href: categoryHref(category.path),
        })),
      ],
    },
    {
      title: 'Your account',
      links: [
        { label: 'Track your order', href: '/track-order' },
        { label: 'Your orders', href: '/account/orders' },
        { label: 'Saved items', href: '/wishlist' },
        { label: 'Sign in', href: '/account/sign-in' },
      ],
    },
  ];
  if (pageLinks.help.length) footerColumns.push({ title: 'Help', links: pageLinks.help });
  if (pageLinks.about.length) footerColumns.push({ title: 'About us', links: pageLinks.about });

  return (
    <div className="flex min-h-screen flex-col">
      {/* Above everything, because a sale notice under the header is a sale
        * notice nobody reads. */}
      {bar && <CampaignBar announcement={bar} />}
      <UtilityBar deliveryNote={deliveryHeadline(delivery.options)} />
      {/* With the merchant's own slides on the homepage there is no
        * discovery hero, so this header carries the only search box and
        * shows it straight away. */}
      <SiteHeader navItems={navItems} heroHasSearch={look.hero.length === 0} />
      <main className="flex-1 pb-16 lg:pb-0">{children}</main>
      <SiteFooter columns={footerColumns} paymentNote={paymentHeadline(checkout.paymentMethods)} />
      <MobileTabBar />
      {modal && <CampaignModal announcement={modal} />}
    </div>
  );
}
