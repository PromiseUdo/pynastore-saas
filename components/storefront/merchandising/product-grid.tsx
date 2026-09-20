/*
 * A plain grid of product cards.
 *
 * Used for "New arrivals" so it reads differently from the bestsellers rail
 * above it — two horizontal carousels in a row start to feel like the same
 * section twice, and there is nothing to discover in the second one.
 *
 * Server component: <ProductCard> is the only client boundary.
 */
import type { Product } from '@/lib/storefront/types';
import { ProductCard } from '@/components/storefront/product/product-card';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function ProductGrid({
  eyebrow,
  title,
  subtitle,
  href,
  products,
  limit = 8,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  href?: string;
  products: Product[];
  limit?: number;
}) {
  const items = products.slice(0, limit);
  if (!items.length) return null;

  return (
    <section className="sf-container sf-section">
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} href={href} />
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
