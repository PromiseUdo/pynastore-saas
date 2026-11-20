/*
 * A plain grid of product cards.
 *
 * Used for "New arrivals" so it reads differently from the bestsellers rail
 * above it — two horizontal carousels in a row start to feel like the same
 * section twice, and there is nothing to discover in the second one.
 *
 * "See all" is centred under the grid, where a shopper who has looked
 * through it is — and only when the page it opens has more (`total`).
 *
 * Server component: <ProductCard> is the only client boundary.
 */
import type { Product } from '@/lib/storefront/types';
import { ProductCard } from '@/components/storefront/product/product-card';
import { SectionHeader } from '@/components/storefront/common/section-header';
import { SeeAllLink } from '@/components/storefront/common/see-all-link';

export function ProductGrid({
  eyebrow,
  title,
  subtitle,
  href,
  linkLabel = 'See all',
  total,
  products,
  limit = 8,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  href?: string;
  /** what "See all" says; name the destination */
  linkLabel?: string;
  /** how many products `href` lists — without it, "See all" always shows */
  total?: number;
  products: Product[];
  limit?: number;
}) {
  const items = products.slice(0, limit);
  if (!items.length) return null;
  const seeAll = href && (total === undefined || total > items.length) ? href : undefined;

  return (
    <section className="sf-container sf-section">
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      {seeAll && <SeeAllLink href={seeAll} label={linkLabel} />}
    </section>
  );
}
