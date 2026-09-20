/*
 * /search with no query — a starting point, not an empty page.
 *
 * Everything offered here is derived from the catalogue and verified to
 * return results: the "popular searches" are real department and brand names
 * this store stocks, and the products are its actual best sellers. Nothing is
 * a hardcoded list of terms that would go stale (or advertise a department
 * the merchant doesn't carry) the moment the catalogue changes.
 */
import Link from 'next/link';
import { Search, TrendingUp } from 'lucide-react';
import { ProductCard } from '@/components/storefront/product/product-card';
import { categoryHref } from '@/lib/storefront/navigation';
import type { Category, Product } from '@/lib/storefront/types';

export function SearchLanding({
  popularSearches,
  categories,
  trending,
}: {
  popularSearches: string[];
  categories: Category[];
  trending: Product[];
}) {
  return (
    <div className="mt-10 space-y-12">
      {popularSearches.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <TrendingUp aria-hidden className="size-4 text-muted-foreground" />
            Popular searches
          </h2>
          <div className="flex flex-wrap gap-2">
            {popularSearches.map((term) => (
              <Link
                key={term}
                href={`/search?q=${encodeURIComponent(term)}`}
                className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
              >
                <Search aria-hidden className="size-3.5 text-muted-foreground" />
                {term}
              </Link>
            ))}
          </div>
        </section>
      )}

      {categories.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Browse by department</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={categoryHref(category.path)}
                className="rounded-xl border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
              >
                {category.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {trending.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold">Trending right now</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {trending.map((product, i) => (
              <ProductCard key={product.id} product={product} priority={i < 4} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
