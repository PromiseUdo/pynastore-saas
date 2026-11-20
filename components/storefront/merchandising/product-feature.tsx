/*
 * One product large, beside a grid of the next four (ROADMAP 15.4) — the
 * "feature" layout of a product band. The first product is whichever the
 * band's source ranks first; nothing is picked by hand here.
 *
 * On a computer the large card's picture stretches to the height of the
 * four beside it (`feature`), so its name and price line up with the bottom
 * row rather than floating under a square picture with a gap above them.
 *
 * "See all" is centred under the grid, and only when the page it opens
 * lists more than the five shown here (`total`).
 *
 * Server component: <ProductCard> is the only client boundary.
 */
import type { Product } from '@/lib/storefront/types';
import { ProductCard } from '@/components/storefront/product/product-card';
import { SectionHeader } from '@/components/storefront/common/section-header';
import { SeeAllLink } from '@/components/storefront/common/see-all-link';

export function ProductFeature({
  title,
  href,
  linkLabel = 'See all',
  total,
  products,
}: {
  title: string;
  href?: string;
  /** what "See all" says; name the destination */
  linkLabel?: string;
  /** how many products `href` lists — without it, "See all" always shows */
  total?: number;
  products: Product[];
}) {
  const [lead, ...rest] = products.slice(0, 5);
  if (!lead) return null;
  const shown = rest.length + 1;
  const seeAll = href && (total === undefined || total > shown) ? href : undefined;

  return (
    <section className="sf-container sf-section">
      <SectionHeader title={title} />
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
      {seeAll && <SeeAllLink href={seeAll} label={linkLabel} />}
    </section>
  );
}
