/*
 * schema.org Product / Offer / AggregateRating.
 *
 * Follows the pattern already used for breadcrumbs
 * (components/storefront/common/breadcrumbs.tsx → BreadcrumbJsonLd).
 *
 * Rule: only fields the catalogue actually holds are emitted. No invented
 * GTINs, no made-up review counts, no availability we cannot substantiate —
 * structured data is a claim to a search engine, and a store that overstates
 * it in markup is misrepresenting itself, not optimising.
 *
 * URLs are built from the tenant's own storefront origin, so this stays
 * correct per merchant rather than hardcoding one domain.
 */
import type { Product, Review } from '@/lib/storefront/types';

export function ProductJsonLd({
  product,
  url,
  reviews = [],
}: {
  product: Product;
  /** absolute, tenant-specific URL of this page */
  url: string;
  reviews?: Review[];
}) {
  const priceRange =
    product.priceFrom === product.priceTo
      ? { price: (product.priceFrom / 100).toFixed(2) }
      : {
          lowPrice: (product.priceFrom / 100).toFixed(2),
          highPrice: (product.priceTo / 100).toFixed(2),
        };

  const json = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription,
    image: product.images.map((image) => image.url),
    sku: product.variants[0]?.sku,
    brand: { '@type': 'Brand', name: product.brandName },
    url,
    offers: {
      '@type': product.priceFrom === product.priceTo ? 'Offer' : 'AggregateOffer',
      priceCurrency: product.currency,
      ...priceRange,
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url,
      ...(product.priceFrom === product.priceTo ? {} : { offerCount: product.variants.length }),
    },
    // Only when there are genuinely ratings behind it.
    ...(product.rating.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.rating.average,
            reviewCount: product.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(reviews.length
      ? {
          review: reviews.slice(0, 5).map((review) => ({
            '@type': 'Review',
            name: review.title,
            reviewBody: review.body,
            datePublished: review.createdAt.slice(0, 10),
            author: { '@type': 'Person', name: review.author },
            reviewRating: {
              '@type': 'Rating',
              ratingValue: review.rating,
              bestRating: 5,
              worstRating: 1,
            },
          })),
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
