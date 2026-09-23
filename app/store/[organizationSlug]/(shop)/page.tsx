/*
 * Storefront homepage — built around product DISCOVERY rather than catalogue
 * display.
 *
 *   1. Discovery hero   — describe it / guided narrowing / image (three ways in)
 *   2. Missions         — "what are you shopping for", cutting across departments
 *   2b. For you         — Recommendation Service; cold-start picks on a first
 *                         visit, refined in the browser once there is a
 *                         session to go on (+ "Continue exploring")
 *   3. Trending         — real bestsellers, ordered by real sales
 *   4. Budget           — bands computed from the real price distribution
 *   5. Deal             — the single urgency moment
 *   6. New arrivals     — a grid, so it doesn't read as "carousel #2"
 *   7. Categories       — traditional browsing, deliberately preserved
 *   8. Promises + story — trust, then the ask
 *
 * Only the hero ships client JS; every band below it is server-rendered. All
 * catalogue reads go through lib/storefront/catalog.ts, which is the single
 * seam where tenant scoping lands when this moves off fixtures onto Prisma.
 */
import { getCategoryTree, getHomepageSections, getStorefrontLook } from '@/lib/storefront/catalog';
import { HeroCarousel } from '@/components/storefront/marketing/hero-carousel';
import { AssistantLauncher } from '@/components/storefront/assistant/assistant-launcher';
import { DiscoveryStrip } from '@/components/storefront/discovery/discovery-strip';
import {
  getExampleQueries,
  getMissions,
  getPriceBands,
  getStoreCurrency,
} from '@/lib/storefront/discovery';
import { DiscoveryHero } from '@/components/storefront/discovery/discovery-hero';
import { ShoppingMissions } from '@/components/storefront/discovery/shopping-missions';
import { PriceExplorer } from '@/components/storefront/discovery/price-explorer';
import { CategoryShowcase } from '@/components/storefront/merchandising/category-showcase';
import { ProductCarousel } from '@/components/storefront/merchandising/product-carousel';
import { ProductGrid } from '@/components/storefront/merchandising/product-grid';
import { DealOfTheDay } from '@/components/storefront/merchandising/deal-of-the-day';
import { ServiceFeatures } from '@/components/storefront/merchandising/service-features';
import { NewsletterBand } from '@/components/storefront/merchandising/newsletter-band';
import { Recommendations } from '@/components/storefront/recommendations/recommendations';
import { RecentlyViewed } from '@/components/storefront/product/recently-viewed';
import { recommendProducts } from '@/lib/storefront/recommendations/service';

type Props = { params: Promise<{ organizationSlug: string }> };

export default async function StorefrontHomePage({ params }: Props) {
  const { organizationSlug } = await params;
  const store = { organizationSlug };
  const currency = await getStoreCurrency(store);

  const [sections, tree, missions, priceBands, examples, look] = await Promise.all([
    getHomepageSections(store),
    getCategoryTree(store),
    getMissions(6, store),
    getPriceBands(currency, store),
    getExampleQueries(currency, 3, store),
    getStorefrontLook(),
  ]);

  const { serviceFeatures, featuredCategories, dealOfTheDay, collections, recommended } = sections;

  const byKey = (key: string) => collections.find((c) => c.key === key);
  // Fall back to the cross-category recommendations so a thin merchandised
  // collection never leaves a band empty.
  const trending = byKey('bestsellers')?.products ?? recommended;
  const newArrivals = byKey('new')?.products ?? recommended;

  /* Products already given a band on this page. "Recommended for you" must
   * add to the page, not repeat the trending carousel back at the shopper. */
  const onPage = [...new Set([...trending, ...newArrivals].map((p) => p.id))];
  const forYou = await recommendProducts({
    store,
    placement: 'homepage',
    context: {},
    exclude: onPage,
  });

  // Root departments, for the guided picker's first question.
  const rootCategories = tree
    .filter((c) => c.productCount > 0)
    .map((c) => ({ id: c.id, name: c.name, path: c.path, productCount: c.productCount }));

  const hasSlides = look.hero.length > 0;

  return (
    <>
      {/*
        * A merchant's own slides REPLACE the discovery hero rather than
        * stacking above it. Two full-width openings in a row is two answers
        * to "what is this shop", and the second one reads as leftover
        * furniture.
        *
        * Nothing is lost by it: the header carries its search box from the
        * first pixel when slides are in use (site-header.tsx), and the
        * assistant moves to a floating button — so both ways in are still
        * one press away.
        */}
      {hasSlides ? (
        <>
          <HeroCarousel slides={look.hero} />
          {/* The discovery tools the hero used to carry: guided narrowing,
            * image search, and — importantly — the surface that ANSWERS the
            * mission and budget tiles below, which publish to the discovery
            * store and had nothing listening once the hero went. */}
          <DiscoveryStrip
            categories={rootCategories}
            priceBands={priceBands.map(({ id, label, minPrice, maxPrice, productCount }) => ({
              id,
              label,
              minPrice,
              maxPrice,
              productCount,
            }))}
          />
          <AssistantLauncher
            seed={{ surface: 'home' }}
            label="Ask the assistant"
            variant="floating"
          />
        </>
      ) : (
        <DiscoveryHero
          categories={rootCategories}
          priceBands={priceBands.map(({ id, label, minPrice, maxPrice, productCount }) => ({
            id,
            label,
            minPrice,
            maxPrice,
            productCount,
          }))}
          examples={examples}
        />
      )}

      <ShoppingMissions missions={missions} />

      <Recommendations
        id="for-you"
        placement="homepage"
        variant="band"
        exclude={onPage}
        initial={forYou}
        showReasons
      />

      {/* Renders nothing for a first-time visitor. */}
      <RecentlyViewed title="Continue exploring" className="sf-container" />

      <ProductCarousel
        eyebrow="Popular with shoppers"
        title="Trending right now"
        subtitle="Ordered by what's actually selling in this store."
        href="/products?sort=bestselling"
        products={trending}
      />

      <PriceExplorer bands={priceBands} />

      {dealOfTheDay && <DealOfTheDay product={dealOfTheDay.product} endsAt={dealOfTheDay.endsAt} />}

      <ProductGrid
        eyebrow="Just landed"
        title="New arrivals"
        subtitle="Fresh in this week across every department."
        href="/products?sort=newest"
        products={newArrivals}
      />

      <CategoryShowcase categories={featuredCategories} />

      <ServiceFeatures features={serviceFeatures} />

      <NewsletterBand />
    </>
  );
}
