/*
 * /search — the search results page.
 *
 * A Server Component: the grid, the chips and the pager are all rendered on
 * the server from the URL, so a shared or refreshed link reproduces the exact
 * same results, and the only JavaScript shipped is the search field, the sort
 * control and the filter panel.
 *
 * All catalogue reads go through lib/storefront/product-discovery.ts — the
 * same service /c/[...path] and /products use. This page owns presentation
 * and nothing else.
 */
import type { Metadata } from 'next';
import { CatalogView } from '@/components/storefront/catalog/catalog-view';
import { SearchField } from '@/components/storefront/catalog/search-field';
import { SearchLanding } from '@/components/storefront/catalog/search-landing';
import { ImageSearchLink } from '@/components/storefront/visual-search/image-search-link';
import { getSearchLandingContent, loadDiscoveryPage } from '@/lib/storefront/product-discovery';
import { getOptionIndex } from '@/lib/storefront/catalog';
import { parseDiscoveryParams } from '@/lib/storefront/discovery-url';
import { Recommendations } from '@/components/storefront/recommendations/recommendations';
import { ShoppingEventBeacon } from '@/components/storefront/recommendations/shopping-event-beacon';
import { recommendProducts } from '@/lib/storefront/recommendations/service';
import { SHOPPING_EVENTS } from '@/lib/storefront/shopping-events';

type Props = {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q;
  const query = (Array.isArray(q) ? q[0] : q)?.trim();
  return {
    title: query ? `Search results for “${query}”` : 'Search',
    // A results page has no business in an index — it is shopper state, not
    // a catalogue page, and search-within-search is a classic crawl trap.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const [{ organizationSlug }, rawParams] = await Promise.all([params, searchParams]);
  const query = typeof rawParams.q === 'string' ? rawParams.q.trim() : undefined;

  /*
   * No query is a legitimate state, not a broken one: show a discovery
   * starting point rather than an empty grid of the entire catalogue.
   */
  if (!query) {
    const [optionIndex, content] = await Promise.all([
      getOptionIndex({ organizationSlug }),
      getSearchLandingContent({ organizationSlug }),
    ]);
    const criteria = parseDiscoveryParams(rawParams, optionIndex);

    return (
      <div className="sf-container py-6 lg:py-10">
        <header className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Discover products</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Search by product, brand or category — or start from one of these.
          </p>
        </header>
        <SearchField criteria={criteria} optionIndex={optionIndex} pathname="/search" />
        {/* The other way to start a search, offered beside the box rather
         * than hidden in a menu — see components/storefront/visual-search. */}
        <p className="mt-3 text-sm text-muted-foreground">
          Don’t know what it’s called? <ImageSearchLink variant="quiet" label="Search by image" />
        </p>
        <SearchLanding {...content} />
      </div>
    );
  }

  const { view, emptyState, emptyCategories } = await loadDiscoveryPage({
    organizationSlug,
    rawParams,
    pathname: '/search',
  });

  const { total, search } = view.result;

  /* Secondary to the results, never a substitute: only offered when the
   * search found something, and never repeating what's already on screen.
   * An empty search keeps its own recovery UI (<NoResults>). */
  const onScreen = view.result.items.map((p) => p.id);
  const related =
    total > 0
      ? await recommendProducts({
          store: { organizationSlug },
          placement: 'search',
          context: { query },
          exclude: onScreen,
        })
      : null;

  return (
    <CatalogView
      view={view}
      pathname="/search"
      emptyState={emptyState}
      emptyCategories={emptyCategories}
      title={<>Results for “{query}”</>}
      outro={
        related && (
          <Recommendations
            placement="search"
            context={{ query }}
            exclude={onScreen}
            initial={related}
            minItems={4}
          />
        )
      }
      subtitle={
        total > 0
          ? `${total.toLocaleString()} ${total === 1 ? 'product' : 'products'}${
              search?.partial ? ' — closest matches' : ''
            }`
          : undefined
      }
    >
      <div>
        <ShoppingEventBeacon event={{ name: SHOPPING_EVENTS.productSearched, query }} />
        <SearchField criteria={view.criteria} optionIndex={view.optionIndex} pathname="/search" />
        <p className="mt-3 text-sm text-muted-foreground">
          Not finding it in words? <ImageSearchLink variant="quiet" label="Search by image" />
        </p>
      </div>
    </CatalogView>
  );
}
