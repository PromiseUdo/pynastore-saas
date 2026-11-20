/*
 * /products/{slug} — the product detail page.
 *
 * `/products/…` is the existing convention: ProductCard, quick view and the
 * search suggestions have all linked here since Phase 1. Introducing
 * `/product/…` alongside it would have meant two URLs for one product, which
 * is worse for shoppers and for search engines than either one alone.
 *
 * Everything is read through lib/storefront/product-detail.ts, which reads
 * through catalog.ts — the page never touches a fixture. That is what makes
 * the later swap to an API repository a change in one file rather than here.
 *
 * Composition: ONE client island (<ProductPurchase>, which needs shared
 * state between the gallery, the variant picker and the price) plus one for
 * the recently-viewed rail, whose ids only exist in the browser. Every other
 * section on this page is server-rendered.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  Breadcrumbs,
  BreadcrumbJsonLd,
} from '@/components/storefront/common/breadcrumbs';
import { HighlightRail } from '@/components/storefront/catalog/highlight-rail';
import { ProductPurchase } from '@/components/storefront/product/product-purchase';
import { ProductDelivery } from '@/components/storefront/product/product-delivery';
import { deliverySummary } from '@/lib/storefront/store-claims';
import { ProductDetails } from '@/components/storefront/product/product-details';
import { ProductReviews } from '@/components/storefront/product/product-reviews';
import { ProductQuestions } from '@/components/storefront/product/product-questions';
import { ProductJsonLd } from '@/components/storefront/product/product-json-ld';
import { RecentlyViewed } from '@/components/storefront/product/recently-viewed';
import { AssistantLauncher } from '@/components/storefront/assistant/assistant-launcher';
import { ChatLauncher } from '@/components/storefront/chat/chat-launcher';
import { CompareSimilar } from '@/components/storefront/product/compare-similar';
import { loadProductPage } from '@/lib/storefront/product-detail';
import { getProductBySlug, getStorePages } from '@/lib/storefront/catalog';
import { hasSizeOption, pageOfKind } from '@/lib/storefront/pages/rules';
import { categoryHref } from '@/lib/storefront/navigation';
import { Recommendations } from '@/components/storefront/recommendations/recommendations';
import { recommendProducts } from '@/lib/storefront/recommendations/service';
import { BOUGHT_TOGETHER_TITLE } from '@/lib/storefront/recommendations/complements';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';
import { storeCheckoutRules } from '@/lib/storefront/checkout/store-config';

type Props = {
  params: Promise<{ organizationSlug: string; slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug, slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: 'Product not found' };

  // Absolute and tenant-specific: each merchant's storefront is its own
  // origin, so a canonical built from a single hardcoded domain would point
  // every store at one of them.
  const url = await storefrontUrlFor(
    organizationSlug,
    `/products/${product.slug}`,
  );

  return {
    title: `${product.name} — ${product.brandName}`,
    description: product.shortDescription,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title: product.name,
      description: product.shortDescription,
      url,
      images: product.images.slice(0, 3).map((image) => ({
        url: image.url,
        alt: image.alt || product.name,
      })),
    },
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { organizationSlug, slug } = await params;

  const data = await loadProductPage(slug, { organizationSlug });
  if (!data) notFound();

  const { product, breadcrumb, reviews, questions, delivery, recommendations } =
    data;
  const {
    cheaper,
    premium,
    fromBrand,
    boughtTogether,
    completeTheLook,
    completeTheLookTitle,
  } = recommendations;

  /* "You may also like" comes from the Recommendation Service: the same
   * similarity score as the rails below, nudged by the session once the
   * browser has one. Server-rendered cold so it paints with the page. */
  const [mayAlsoLike, pages] = await Promise.all([
    recommendProducts({
      store: { organizationSlug },
      placement: 'product',
      context: { productId: product.id },
    }),
    getStorePages({ organizationSlug }),
  ]);

  /* The merchant's size guide, offered beside the size picker — only when
   * they've published one and this product actually comes in sizes. */
  const sizeGuide = hasSizeOption(product.options.map((o) => o.name))
    ? pageOfKind(pages, 'SIZE_GUIDE')
    : null;

  const crumbs = [
    { label: 'Home', href: '/' },
    ...breadcrumb.map((category) => ({
      label: category.name,
      href: categoryHref(category.path),
    })),
    { label: product.name },
  ];

  /* "Pay on delivery isn't available for this item" means nothing in a shop
   * that doesn't offer pay on delivery at all. */
  const { payOnDelivery } = await storeCheckoutRules(organizationSlug);

  return (
    <div className="sf-container py-4 lg:py-8">
      {/* One scrollable line on a phone: a wrapped trail ending in a long
       * product name can take three lines before the photograph starts. */}
      <Breadcrumbs
        items={crumbs}
        className="sf-no-scrollbar -mx-5 mb-3 overflow-x-auto whitespace-nowrap px-5 sm:mx-0 sm:mb-5 sm:flex-wrap sm:px-0 sm:whitespace-normal"
      />

      <ProductPurchase
        product={product}
        deliveryPanel={
          <ProductDelivery
            delivery={delivery}
            requiresPrepayment={product.requiresPrepayment && payOnDelivery}
          />
        }
        deliverySummary={deliverySummary(delivery.options)}
        sizeGuideHref={sizeGuide?.href ?? null}
        shareUrl={await storefrontUrlFor(
          organizationSlug,
          `/products/${product.slug}`,
        )}
      />

      <div className="mt-10 border-t pt-8 lg:mt-14 lg:pt-10">
        <ProductDetails product={product} />
      </div>

      <div className="mt-10 border-t pt-8 lg:mt-14 lg:pt-10">
        <ProductReviews
          product={product}
          reviews={reviews.items}
          total={reviews.total}
          viewer={{
            canReview: reviews.viewer.canReview,
            own: reviews.viewer.own,
            votedIds: reviews.votedIds,
            signedIn: reviews.signedIn,
          }}
        />
      </div>

      {/* With no answered questions and neither way to ask on the shop's
       * plan, the whole block (rule included) goes. */}
      <div
        className={
          'mt-10 border-t pt-8 lg:mt-14 lg:pt-10' +
          (questions.items.length === 0 ? ' has-[[data-ask]:empty]:hidden' : '')
        }
      >
        <ProductQuestions
          product={product}
          questions={questions.items}
          /* Two ways to ask — and a third way to decide: the shop's AI,
           * from this product's own listing, reviews and the store's
           * policies; and a message to the store team (ROADMAP 17.3 — shown
           * only when the shop takes messages). The public "Ask a question"
           * form was retired 2026-11-19 (see product-questions.tsx). */
          ask={
            <>
              <AssistantLauncher
                seed={{
                  surface: 'product',
                  productSlug: product.slug,
                  productName: product.name,
                }}
              />
              <ChatLauncher
                variant="button"
                product={{ id: product.id, name: product.name }}
              />
              {/* Side by side with its closest matches — the same products as
               * "You may also like" below, so the two agree on "similar". */}
              <CompareSimilar
                product={product}
                candidates={mayAlsoLike.items.map((item) => item.product)}
              />
            </>
          }
        />
      </div>

      {/* ── recommendations ──────────────────────────────────────────
       * Each rail answers a different question, and each is dropped
       * entirely when the catalogue has nothing honest to put in it. */}
      <Recommendations
        id="similar"
        placement="product"
        context={{ productId: product.id }}
        initial={mayAlsoLike}
      />

      <div id="cheaper" className="scroll-mt-24">
        <HighlightRail
          title="Want something cheaper?"
          subtitle="Related products that cost less."
          products={cheaper}
        />
      </div>

      <div id="premium" className="scroll-mt-24">
        <HighlightRail
          title="Looking to spend a bit more?"
          subtitle="Related products that cost more and are rated higher or sell harder."
          products={premium}
        />
      </div>

      <HighlightRail
        title={BOUGHT_TOGETHER_TITLE}
        subtitle="Customers who bought this also ordered these from us."
        products={boughtTogether}
      />

      <HighlightRail title={completeTheLookTitle} products={completeTheLook} />

      <HighlightRail
        title={`More from ${product.brandName}`}
        products={fromBrand}
      />

      <RecentlyViewed excludeProductId={product.id} />

      <BreadcrumbJsonLd
        items={crumbs}
        baseUrl={(await storefrontUrlFor(organizationSlug)).replace(/\/$/, '')}
      />
      <ProductJsonLd
        product={product}
        url={await storefrontUrlFor(
          organizationSlug,
          `/products/${product.slug}`,
        )}
        reviews={reviews.items}
      />
    </div>
  );
}
