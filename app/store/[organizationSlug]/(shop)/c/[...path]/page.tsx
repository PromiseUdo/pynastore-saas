/*
 * /c/{category}/{sub}/{leaf} — category browsing.
 *
 * Uses the SAME discovery service as /search, with the category pinned as a
 * default the URL cannot override. So filtering, sorting, faceting, paging
 * and the chip model are shared code — a category page is a search with a
 * starting constraint, not a second engine.
 *
 * What this page adds on top of the shared results surface is CONTEXT, in a
 * fixed order: where am I (breadcrumb + header), what's inside (subcategory
 * navigation), what's good (a short best-selling rail), then the catalogue
 * with its filters. The rail and the subcategory cards are suppressed the
 * moment the shopper starts searching or filtering — at that point they have
 * told us what they want, and editorial above their results is in the way.
 *
 * `/c/...` is the existing convention (see lib/storefront/navigation.ts,
 * which the header mega-menu and every category link already build against).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogView } from '@/components/storefront/catalog/catalog-view';
import { Recommendations } from '@/components/storefront/recommendations/recommendations';
import { ShoppingEventBeacon } from '@/components/storefront/recommendations/shopping-event-beacon';
import { recommendProducts } from '@/lib/storefront/recommendations/service';
import { SHOPPING_EVENTS } from '@/lib/storefront/shopping-events';
import { SearchField } from '@/components/storefront/catalog/search-field';
import { CategoryHeader } from '@/components/storefront/category/category-header';
import { SubcategoryNav } from '@/components/storefront/category/subcategory-nav';
import {
  getCategoryLanding,
  loadDiscoveryPage,
} from '@/lib/storefront/product-discovery';
import { getCategoryByPath } from '@/lib/storefront/catalog';
import { hasActiveFilters } from '@/lib/storefront/discovery-url';
import { categoryHref } from '@/lib/storefront/navigation';

type Props = {
  params: Promise<{ organizationSlug: string; path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug, path } = await params;
  const category = await getCategoryByPath(path, { organizationSlug });
  if (!category) return {};
  return { title: category.name, description: category.description };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ organizationSlug, path }, rawParams] = await Promise.all([
    params,
    searchParams,
  ]);

  // Resolve first: an unknown path is a 404, not an empty result set.
  const category = await getCategoryByPath(path, { organizationSlug });
  if (!category) notFound();

  const pathname = categoryHref(category.path);
  const store = { organizationSlug };

  const [{ view, emptyState, emptyCategories }, landing, popular] =
    await Promise.all([
      loadDiscoveryPage({
        organizationSlug,
        rawParams,
        pathname,
        // Pinned: the category comes from the route, so no query string can
        // move this page to a different department.
        defaults: { categoryPath: category.path },
      }),
      getCategoryLanding({ store, category }),
      recommendProducts({
        store,
        placement: 'category',
        context: { categoryPath: category.path },
        limit: 6,
      }),
    ]);

  const { criteria, result } = view;
  const { children, siblings } = landing;
  /* A popular rail only earns its space with a real run of products — and
   * only while every item really is from this category (not a fallback). */
  const showPopular = popular.strategy === 'contextual' && popular.total >= 4;

  /* Browsing vs. narrowing. Once there is a query, a filter or a second page
   * in play, the shopper is working — everything editorial folds away and
   * the grid moves up. */
  const browsing =
    !criteria.q &&
    !hasActiveFilters(criteria) &&
    criteria.page === 1 &&
    result.total > 0;

  const subcategories = children.length ? children : siblings;
  const subcategoryTitle = children.length
    ? `Browse ${category.name}`
    : `More in ${landing.chain[landing.chain.length - 2]?.name ?? 'this department'}`;

  return (
    <CatalogView
      view={view}
      pathname={pathname}
      emptyState={emptyState}
      emptyCategories={emptyCategories}
      showChildCategories={false}
      crumbs={[
        { label: 'Home', href: '/' },
        ...landing.chain.map((c) => ({
          label: c.name,
          href: categoryHref(c.path),
        })),
      ]}
      // header={
      //   <CategoryHeader category={category} productCount={result.total} />
      // }
      intro={
        <>
          <SubcategoryNav
            categories={subcategories}
            // Cards for a department the shopper is still choosing an aisle
            // in; chips once they are deep enough to just want the sideways
            // move.
            variant={
              category.level === 0 && children.length ? 'cards' : 'chips'
            }
            title={subcategoryTitle}
          />
          {browsing && showPopular && (
            <Recommendations
              placement="category"
              context={{ categoryPath: category.path }}
              limit={6}
              initial={popular}
              categoryName={category.name}
              href={`${pathname}?sort=bestselling`}
              minItems={4}
            />
          )}
        </>
      }
      gridTitle={browsing && showPopular ? `All ${category.name}` : undefined}
    >
      <ShoppingEventBeacon
        event={{
          name: SHOPPING_EVENTS.categoryViewed,
          categoryPath: category.path,
        }}
      />
      <SearchField
        criteria={criteria}
        optionIndex={view.optionIndex}
        pathname={pathname}
        placeholder={`Search within ${category.name}`}
      />
    </CatalogView>
  );
}
