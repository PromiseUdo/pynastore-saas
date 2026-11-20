/*
 * /cart — the full bag.
 *
 * A Server Component that renders the page furniture (breadcrumb, heading,
 * metadata) and hands the bag itself to <CartView />, which is a Client
 * Component because the cart lives in the browser today. Keeping the split
 * here means the page does not become a client tree just to show a list.
 *
 * Nothing is indexed: a bag is one shopper's state, not a catalogue page.
 */
import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/storefront/common/breadcrumbs';
import { CartView } from '@/components/storefront/cart/cart-view';
import { shopVatBySlug } from '@/lib/tax-settings';
import { getBuyerPricing } from '@/lib/storefront/trade-gate';

export const metadata: Metadata = {
  title: 'Your bag',
  robots: { index: false, follow: true },
};

export default async function CartPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  // Only a VAT-registered store states any VAT (ROADMAP 14.1).
  const { organizationSlug } = await params;
  const [vat, pricing] = await Promise.all([shopVatBySlug(organizationSlug), getBuyerPricing(organizationSlug)]);
  return (
    <div className="sf-container py-6 lg:py-10">
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Bag' }]} className="mb-4" />

      <header>
        <h1 className="font-display text-2xl leading-tight sm:text-3xl">Your bag</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review what you’ve picked, change quantities, then head to checkout.
        </p>
      </header>

      {/* A wholesaler at a shop that quotes wholesale before VAT has it added (ROADMAP 21.2). */}
      <CartView vatRatePct={vat?.ratePct ?? null} vatAdded={pricing.vatAdded} tradeMinOrderValue={pricing.minOrderValue} />
    </div>
  );
}
