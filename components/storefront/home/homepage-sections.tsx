/*
 * The shop's front page, rendered from its section list (ROADMAP 15.2).
 *
 * THE REGISTRY. Each section type is one entry: a `load` that gathers what
 * the section needs (through lib/storefront/catalog.ts, the discovery
 * helpers or the Recommendation Service — never its own picking), and a
 * `render` that hands it to the component that already drew that band. A
 * new section type is a schema entry plus a registry entry; the page itself
 * never changes.
 *
 * A loader returns null when it has nothing honest to show — a deleted
 * collection, an empty band, no deal today — and that section is simply
 * left out. Nothing here throws a shopper an error.
 *
 * Two passes, because "Recommended for you" must add to the page rather
 * than repeat it: it is loaded after the product bands, excluding what they
 * already show.
 *
 * Server component; only the components that were already interactive
 * (hero, discovery, recommendations, recently viewed) ship client code.
 */
import { Fragment, type ReactNode } from 'react';
import {
  getBrandShowcase,
  getCategoryTree,
  getHomepageSections,
  getSectionProducts,
  getStoreReviews,
  getStorefrontLook,
} from '@/lib/storefront/catalog';
import { getExampleQueries, getMissions, getPriceBands, getStoreCurrency } from '@/lib/storefront/discovery';
import { recommendProducts } from '@/lib/storefront/recommendations/service';
import type { HomepageSection, SectionType } from '@/lib/storefront/sections/schema';
import type { Product, StoreScope } from '@/lib/storefront/types';
import { HeroCarousel } from '@/components/storefront/marketing/hero-carousel';
import { AssistantLauncher } from '@/components/storefront/assistant/assistant-launcher';
import { DiscoveryStrip } from '@/components/storefront/discovery/discovery-strip';
import { DiscoveryHero } from '@/components/storefront/discovery/discovery-hero';
import { ShoppingMissions } from '@/components/storefront/discovery/shopping-missions';
import { PriceExplorer } from '@/components/storefront/discovery/price-explorer';
import { CategoryShowcase } from '@/components/storefront/merchandising/category-showcase';
import { ProductCarousel } from '@/components/storefront/merchandising/product-carousel';
import { ProductGrid } from '@/components/storefront/merchandising/product-grid';
import { DealOfTheDay } from '@/components/storefront/merchandising/deal-of-the-day';
import { ServiceFeatures } from '@/components/storefront/merchandising/service-features';
import { Recommendations } from '@/components/storefront/recommendations/recommendations';
import { RecentlyViewed } from '@/components/storefront/product/recently-viewed';
import { ProductFeature } from '@/components/storefront/merchandising/product-feature';
import { ImageText } from '@/components/storefront/merchandising/image-text';
import { BrandShowcase } from '@/components/storefront/merchandising/brand-showcase';
import { StoreReviews } from '@/components/storefront/merchandising/store-reviews';

/* ─── What several sections share, fetched at most once per page ──────── */

function sharedData(store: StoreScope) {
  const once = <T,>(load: () => Promise<T>) => {
    let promise: Promise<T> | null = null;
    return () => (promise ??= load());
  };
  const currency = once(() => getStoreCurrency(store));
  return {
    store,
    look: once(() => getStorefrontLook(store)),
    homepage: once(() => getHomepageSections(store)),
    missions: once(() => getMissions(6, store)),
    priceBands: once(async () => getPriceBands(await currency(), store)),
    examples: once(async () => getExampleQueries(await currency(), 3, store)),
    /** root departments, for the guided picker's first question */
    rootCategories: once(async () =>
      (await getCategoryTree(store))
        .filter((c) => c.productCount > 0)
        .map((c) => ({ id: c.id, name: c.name, path: c.path, productCount: c.productCount })),
    ),
  };
}
type Shared = ReturnType<typeof sharedData>;

interface LoadContext {
  shared: Shared;
  /** products already in a band above or below — filled before pass two */
  onPage: string[];
}

type Of<T extends SectionType> = Extract<HomepageSection, { type: T }>;

interface SectionDefinition<T extends SectionType, P> {
  /** loaded after every other section, once `onPage` is known */
  late?: boolean;
  load: (section: Of<T>, context: LoadContext) => Promise<P | null>;
  render: (props: P, section: Of<T>) => ReactNode;
  /** product ids this section puts on the page */
  productIds?: (props: P) => string[];
}

/** `type` is only there so each entry's loader and renderer see their own section's shape. */
function define<T extends SectionType, P>(_type: T, definition: SectionDefinition<T, P>) {
  return definition;
}

const bands = async (shared: Shared) =>
  (await shared.priceBands()).map(({ id, label, minPrice, maxPrice, productCount }) => ({
    id,
    label,
    minPrice,
    maxPrice,
    productCount,
  }));

/* ─── The registry ────────────────────────────────────────────────────── */

const REGISTRY = {
  /*
   * The merchant's slides REPLACE the discovery hero rather than stacking
   * above it — two full-width openings is two answers to "what is this
   * shop". Nothing is lost: the header shows its search box straight away
   * when slides are in use, the assistant becomes a floating button, and
   * DiscoveryStrip carries the guided narrowing — and is what ANSWERS the
   * mission and budget tiles, which publish to the discovery store.
   */
  hero: define('hero', {
    load: async (_section, { shared }) => {
      const [look, categories, priceBands, examples] = await Promise.all([
        shared.look(),
        shared.rootCategories(),
        bands(shared),
        shared.examples(),
      ]);
      return { slides: look.hero, categories, priceBands, examples };
    },
    render: ({ slides, categories, priceBands, examples }, section) =>
      slides.length > 0 ? (
        <>
          <HeroCarousel slides={slides} layout={section.variant} />
          <DiscoveryStrip categories={categories} priceBands={priceBands} />
          <AssistantLauncher seed={{ surface: 'home' }} label="Ask the assistant" variant="floating" />
        </>
      ) : (
        <DiscoveryHero categories={categories} priceBands={priceBands} examples={examples} />
      ),
  }),

  'shopping-missions': define('shopping-missions', {
    load: async (_section, { shared }) => ({ missions: await shared.missions() }),
    render: ({ missions }) => <ShoppingMissions missions={missions} />,
  }),

  recommended: define('recommended', {
    late: true,
    load: async (_section, { shared, onPage }) => ({
      onPage,
      initial: await recommendProducts({ store: shared.store, placement: 'homepage', context: {}, exclude: onPage }),
    }),
    render: ({ onPage, initial }) => (
      <Recommendations
        id="for-you"
        placement="homepage"
        variant="band"
        exclude={onPage}
        initial={initial}
        showReasons
      />
    ),
  }),

  /* Renders nothing for a first-time visitor. */
  'recently-viewed': define('recently-viewed', {
    load: async () => ({}),
    render: () => <RecentlyViewed title="Continue exploring" className="sf-container" />,
  }),

  products: define('products', {
    load: async (section, { shared }) => getSectionProducts(section.source, shared.store),
    render: ({ products, href }: { products: Product[]; href: string }, section) =>
      section.variant === 'grid' ? (
        <ProductGrid title={section.title} href={href} products={products} />
      ) : section.variant === 'feature' ? (
        <ProductFeature title={section.title} href={href} products={products} />
      ) : (
        <ProductCarousel title={section.title} href={href} products={products} />
      ),
    productIds: ({ products }) => products.map((p) => p.id),
  }),

  'price-explorer': define('price-explorer', {
    load: async (_section, { shared }) => ({ bands: await shared.priceBands() }),
    render: ({ bands: priceBands }) => <PriceExplorer bands={priceBands} />,
  }),

  'deal-of-the-day': define('deal-of-the-day', {
    load: async (_section, { shared }) => (await shared.homepage()).dealOfTheDay,
    render: (deal) => <DealOfTheDay product={deal.product} endsAt={deal.endsAt} />,
  }),

  'category-showcase': define('category-showcase', {
    load: async (_section, { shared }) => ({ categories: (await shared.homepage()).featuredCategories }),
    render: ({ categories }, section) => <CategoryShowcase categories={categories} variant={section.variant} />,
  }),

  'service-features': define('service-features', {
    load: async (_section, { shared }) => ({ features: (await shared.homepage()).serviceFeatures }),
    render: ({ features }) => <ServiceFeatures features={features} />,
  }),

  /* The merchant's own picture and words — nothing to fetch. */
  'image-text': define('image-text', {
    load: async (section) => ({ imageUrl: section.image?.url ?? null }),
    render: ({ imageUrl }, section) => (
      <ImageText
        heading={section.heading}
        body={section.body}
        imageUrl={imageUrl}
        imageSide={section.imageSide}
        buttonLabel={section.buttonLabel}
        buttonHref={section.buttonHref}
      />
    ),
  }),

  brands: define('brands', {
    load: async (_section, { shared }) => {
      const brands = await getBrandShowcase(shared.store);
      return brands.length ? { brands } : null;
    },
    render: ({ brands }) => <BrandShowcase brands={brands} />,
  }),

  reviews: define('reviews', {
    load: async (_section, { shared }) => {
      const reviews = await getStoreReviews(shared.store);
      return reviews.length ? { reviews } : null;
    },
    render: ({ reviews }) => <StoreReviews reviews={reviews} />,
  }),
} satisfies Record<SectionType, unknown>; // every section type has an entry — a missing one fails to compile

/* The registry is keyed by type, so a section always meets its own entry;
 * this one cast is where TypeScript stops being able to see that. */
type AnyDefinition = SectionDefinition<SectionType, unknown> & {
  load: (section: HomepageSection, context: LoadContext) => Promise<unknown>;
  render: (props: unknown, section: HomepageSection) => ReactNode;
};
const definitionOf = (section: HomepageSection) => REGISTRY[section.type] as unknown as AnyDefinition;

/* ─── The page ────────────────────────────────────────────────────────── */

export async function HomepageSections({
  store,
  sections,
}: {
  store: StoreScope;
  sections: HomepageSection[];
}) {
  const enabled = sections.filter((section) => section.enabled);
  const context: LoadContext = { shared: sharedData(store), onPage: [] };

  const loaded: unknown[] = await Promise.all(
    enabled.map((section) => (definitionOf(section).late ? null : definitionOf(section).load(section, context))),
  );

  /* Products the bands already show, in page order, once each. */
  context.onPage = [
    ...new Set(enabled.flatMap((section, i) => {
      const definition = definitionOf(section);
      return loaded[i] && definition.productIds ? definition.productIds(loaded[i]) : [];
    })),
  ];

  await Promise.all(
    enabled.map(async (section, i) => {
      if (definitionOf(section).late) loaded[i] = await definitionOf(section).load(section, context);
    }),
  );

  return (
    <>
      {enabled.map((section, i) =>
        loaded[i] == null ? null : (
          <Fragment key={section.id}>{definitionOf(section).render(loaded[i], section)}</Fragment>
        ),
      )}
    </>
  );
}
