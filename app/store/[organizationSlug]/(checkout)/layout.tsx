/*
 * (checkout) route group — the storefront with its distractions removed.
 *
 * A deliberate sibling of (shop), which carries the utility bar, the
 * category nav, the mega-menu, the footer and the mobile tab bar. None of
 * that belongs here: once someone is buying, every extra link is a way out
 * of the purchase, and a sticky category nav on a phone is the same pixels
 * the address form needs (Sections 42/43).
 *
 * What survives is the wordmark (so it is obvious whose store this is), a
 * way back to the bag, and one line of reassurance. No search, no
 * recommendations, no promotions, no newsletter, no trending rail.
 *
 * Chrome lives in the route group rather than in the page so the checkout
 * and the confirmation share it without either importing a header.
 */
import Link from 'next/link';
import { CheckoutChrome } from '@/components/storefront/checkout/checkout-chrome';
import { getStorePages } from '@/lib/storefront/catalog';
import { checkoutPageLinks } from '@/lib/storefront/pages/rules';

export default async function CheckoutLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  return (
    <div className="flex min-h-screen flex-col">
      <CheckoutChrome />
      <main className="flex-1">
        <div className="sf-container py-7 lg:py-12">{children}</div>
      </main>
      <CheckoutFooter organizationSlug={organizationSlug} />
    </div>
  );
}

/*
 * Policy links only — the things a shopper legitimately wants to check
 * BEFORE paying: delivery and returns, terms, privacy, how to reach the
 * store. Each one appears only when the merchant has published that page
 * (lib/storefront/pages/rules.ts `checkoutPageLinks`), so a store that
 * hasn't written its terms shows no terms link rather than a 404.
 */
async function CheckoutFooter({ organizationSlug }: { organizationSlug: string }) {
  const pages = checkoutPageLinks(await getStorePages({ organizationSlug }));
  /* Policy pages open in a new tab: following one mid-checkout shouldn't
   * cost the shopper the address they were halfway through typing. */
  const links = [
    ...pages.map((page) => ({ label: page.title, href: page.href, newTab: true })),
    { label: 'Track your order', href: '/track-order', newTab: false },
  ];

  return (
    <footer className="border-t py-6">
      <div className="sf-container flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="hover:text-brand"
            {...(link.newTab ? { target: '_blank', rel: 'noopener' } : {})}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </footer>
  );
}
