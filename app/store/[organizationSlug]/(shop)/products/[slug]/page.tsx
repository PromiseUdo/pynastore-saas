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
import { Breadcrumbs, BreadcrumbJsonLd } from '@/components/storefront/common/breadcrumbs';
import { HighlightRail } from '@/components/storefront/catalog/highlight-rail';
import { ProductPurchase } from '@/components/storefront/product/product-purchase';
import { ProductDelivery } from '@/components/storefront/product/product-delivery';
import { ProductDetails } from '@/components/storefront/product/product-details';
import { ProductReviews } from '@/components/storefront/product/product-reviews';
import { ProductQuestions } from '@/components/storefront/product/product-questions';
import { ProductJsonLd } from '@/components/storefront/product/product-json-ld';
import { RecentlyViewed } from '@/components/storefront/product/recently-viewed';
import {
  DecisionHelp,
  type DecisionShortcut,
} from '@/components/storefront/product/decision-help';
import { AssistantLauncher } from '@/components/storefront/assistant/assistant-launcher';
import { loadProductPage } from '@/lib/storefront/product-detail';
import { getProductBySlug, getStorePages } from '@/lib/storefront/catalog';
import { hasSizeOption, pageOfKind } from '@/lib/storefront/pages/rules';
import { categoryHref } from '@/lib/storefront/navigation';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { findSimilarHref } from '@/lib/storefront/visual-search/query';
import { Recommendations } from '@/components/storefront/recommendations/recommendations';
import { recommendProducts } from '@/lib/storefront/recommendations/service';
import { BOUGHT_TOGETHER_TITLE } from '@/lib/storefront/recommendations/complements';

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
  const url = getStorefrontUrl(organizationSlug, `/products/${product.slug}`);

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

  const { product, breadcrumb, reviews, questions, delivery, recommendations } = data;
  const { cheaper, premium, fromBrand, boughtTogether, completeTheLook, completeTheLookTitle } = recommendations;

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
  const sizeGuide = hasSizeOption(product.options.map((o) => o.name)) ? pageOfKind(pages, 'SIZE_GUIDE') : null;

  const crumbs = [
    { label: 'Home', href: '/' },
    ...breadcrumb.map((category) => ({ label: category.name, href: categoryHref(category.path) })),
    { label: product.name },
  ];

  /* Only offer a shortcut to a section that is actually on the page — plus
   * the one that leaves it: "find similar" runs this product through the
   * visual-search service, which (having no vision model yet) simulates the
   * likeness from the product's own department, colours and material (§21). */
  const shortcuts: DecisionShortcut[] = [
    {
      id: 'find-similar',
      href: findSimilarHref(product.id),
      label: 'Find similar products',
      icon: 'visual' as const,
    },
    cheaper.length ? { id: 'cheaper', href: '#cheaper', label: 'Something cheaper', icon: 'cheaper' as const } : null,
    premium.length ? { id: 'premium', href: '#premium', label: 'A step up', icon: 'premium' as const } : null,
    mayAlsoLike.total ? { id: 'similar', href: '#similar', label: 'Compare similar', icon: 'similar' as const } : null,
    questions.items.length ? { id: 'ask', href: '#questions', label: 'Common questions', icon: 'ask' as const } : null,
  ].filter((s): s is DecisionShortcut => s !== null);

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
        deliveryPanel={<ProductDelivery delivery={delivery} requiresPrepayment={product.requiresPrepayment} />}
        sizeGuideHref={sizeGuide?.href ?? null}
      />

      {/*
        * The assistant's product-page entry point. It is given the slug
        * only — the server resolves the row itself, so the page never hands
        * product data to a client component (§10).
        */}
      <div className="mt-8 lg:mt-14">
        <DecisionHelp
          shortcuts={shortcuts}
          action={
            <AssistantLauncher
              label="Ask about this product"
              seed={{ surface: 'product', productSlug: product.slug, productName: product.name }}
            />
          }
        />
      </div>

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

      <div className="mt-10 border-t pt-8 lg:mt-14 lg:pt-10">
        <ProductQuestions
          product={product}
          questions={questions.items}
          viewer={{ pending: questions.pending, signedIn: questions.signedIn }}
          /* Two ways to ask: the form reaches the store team and its answer
            * is published here, and the assistant answers now from this
            * product's own listing, reviews and the store's policies. */
          ask={
            <AssistantLauncher
              label="Or ask the store assistant now"
              seed={{ surface: 'product', productSlug: product.slug, productName: product.name }}
            />
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
          subtitle="Related products that cost less — nearest first."
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

      <HighlightRail title={`More from ${product.brandName}`} products={fromBrand} />

      <RecentlyViewed excludeProductId={product.id} />

      <BreadcrumbJsonLd items={crumbs} baseUrl={getStorefrontUrl(organizationSlug).replace(/\/$/, '')} />
      <ProductJsonLd
        product={product}
        url={getStorefrontUrl(organizationSlug, `/products/${product.slug}`)}
        reviews={reviews.items}
      />
    </div>
  );
}
