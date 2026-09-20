/*
 * /products — the whole catalogue, unscoped.
 *
 * The homepage already links here with `?sort=bestselling` / `?sort=newest`,
 * and it is where "browse everything" lands. Same service, no category pinned.
 */
import type { Metadata } from 'next';
import { CatalogView } from '@/components/storefront/catalog/catalog-view';
import { SearchField } from '@/components/storefront/catalog/search-field';
import { loadDiscoveryPage } from '@/lib/storefront/product-discovery';

type Props = {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: 'All products',
  description: 'Browse the full catalogue — filter by price, brand, colour, size and rating.',
};

export default async function ProductsPage({ params, searchParams }: Props) {
  const [{ organizationSlug }, rawParams] = await Promise.all([params, searchParams]);

  const { view, emptyState, emptyCategories } = await loadDiscoveryPage({
    organizationSlug,
    rawParams,
    pathname: '/products',
  });

  return (
    <CatalogView
      view={view}
      pathname="/products"
      emptyState={emptyState}
      emptyCategories={emptyCategories}
      title="All products"
      subtitle="Everything in the store. Narrow it down with the filters."
    >
      <SearchField
        criteria={view.criteria}
        optionIndex={view.optionIndex}
        pathname="/products"
        placeholder="Search within all products"
      />
    </CatalogView>
  );
}
