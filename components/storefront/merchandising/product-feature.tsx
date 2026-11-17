/*
 * One product large, beside a grid of the next four (ROADMAP 15.4) — the
 * "feature" layout of a product band. The first product is whichever the
 * band's source ranks first; nothing is picked by hand here.
 *
 * On a computer the large card's picture stretches to the height of the
 * four beside it (`feature`), so its name and price line up with the bottom
 * row rather than floating under a square picture with a gap above them.
 *
 * Server component: <ProductCard> is the only client boundary.
 */
import type { Product } from '@/lib/storefront/types';
import { ProductCard } from '@/components/storefront/product/product-card';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function ProductFeature({ title, href, products }: { title: string; href?: string; products: Product[] }) {
  const [lead, ...rest] = products.slice(0, 5);
  if (!lead) return null;

  return (
    <section className="sf-container sf-section">
      <SectionHeader title={title} href={href} />
      <div className="grid gap-x-5 gap-y-10 lg:grid-cols-2">
        <ProductCard product={lead} priority feature />
        {rest.length > 0 && (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10">
            {rest.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
