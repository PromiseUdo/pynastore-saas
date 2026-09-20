/*
 * The results surface shared by /search, /c/[...path] and /products.
 *
 * Search and category browsing are the SAME experience with a different
 * starting constraint, so they render through one component over one service
 * (lib/storefront/product-discovery.ts). Building two would have guaranteed
 * that a fix to one silently missed the other.
 *
 * Server component. The only client islands are the toolbar (sort + the
 * mobile filter sheet) and the sidebar filter panel — everything else,
 * including every filter-removal chip and pager link, is a plain <a>.
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Breadcrumbs, type Crumb } from '@/components/storefront/common/breadcrumbs';
import { CatalogToolbar } from './catalog-toolbar';
import { FilterPanel } from './filter-panel';
import { ActiveFilters } from './active-filters';
import { ResultsGrid } from './results-grid';
import { Pagination } from './pagination';
import { NoResults } from './no-results';
import { categoryHref } from '@/lib/storefront/navigation';
import { hasActiveFilters } from '@/lib/storefront/discovery-url';
import type { DiscoveryView, EmptyStateOptions } from '@/lib/storefront/product-discovery';
import type { Category } from '@/lib/storefront/types';

export function CatalogView({
  view,
  pathname,
  title,
  subtitle,
  crumbs,
  emptyState,
  emptyCategories,
  header,
  intro,
  gridTitle,
  showChildCategories = true,
  outro,
  /** rendered between the heading and the toolbar (the search field on /search) */
  children,
}: {
  view: DiscoveryView;
  pathname: string;
  /** ignored when `header` is supplied */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  crumbs?: Crumb[];
  emptyState: EmptyStateOptions;
  emptyCategories: Category[];
  /** replaces the plain h1 block — the category banner / collection hero */
  header?: React.ReactNode;
  /** full-width editorial content between the header and the results
   *  (subcategory navigation, a "popular in" rail) */
  intro?: React.ReactNode;
  /** heading above the toolbar, e.g. "All Shoes" — the line that tells a
   *  shopper the editorial section above has ended and the catalogue begins */
  gridTitle?: React.ReactNode;
  /** suppress the built-in chip rail when the page renders its own */
  showChildCategories?: boolean;
  /** full-width content after the results — secondary to them, never in
   *  their place (e.g. "You might also like" on /search) */
  outro?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { criteria, result, optionIndex, currency, activeFilters, clearHref, childCategories, pageHref } = view;
  const filterProps = {
    criteria,
    facets: result.facets,
    optionIndex,
    pricePresets: view.pricePresets,
    currency,
    pathname,
  };

  return (
    <div className="sf-container py-6 lg:py-10">
      {crumbs && crumbs.length > 1 && (
        <Breadcrumbs
          items={crumbs}
          // One scrollable line on a phone rather than a wrapped trail.
          className="sf-no-scrollbar -mx-5 mb-3 overflow-x-auto whitespace-nowrap px-5 sm:mx-0 sm:mb-4 sm:px-0"
        />
      )}

      {header ?? (
        <header className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        </header>
      )}

      {children}

      {intro}

      {/* Subcategory rail — the fastest way to go one level deeper, and the
        * reason a category page doesn't need a nested menu. */}
      {showChildCategories && childCategories.length > 0 && (
        <nav aria-label="Subcategories" className="sf-no-scrollbar -mx-1 mt-6 flex gap-2 overflow-x-auto px-1">
          {childCategories.map((child) => (
            <Link
              key={child.id}
              href={categoryHref(child.path)}
              className="shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
            >
              {child.name}
            </Link>
          ))}
        </nav>
      )}

      {/* Sidebar + results. The sidebar is sticky so filters stay reachable
        * deep into a long grid without scrolling back up. */}
      <div className="mt-6 grid gap-x-10 gap-y-6 lg:mt-8 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 sf-thin-scrollbar">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Filters</h2>
              {hasActiveFilters(criteria) && (
                <Link
                  href={clearHref}
                  scroll={false}
                  className="text-xs font-medium text-brand underline-offset-4 hover:underline"
                >
                  Clear all
                </Link>
              )}
            </div>
            <FilterPanel {...filterProps} />
          </div>
        </aside>

        <div className="min-w-0">
          {gridTitle && (
            <h2 className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">{gridTitle}</h2>
          )}
          {/* Below lg there is no sidebar, so Filters and Sort pin under the
            * header (4.5rem there) instead — the phone equivalent of the
            * sticky sidebar, reachable forty cards down. Only the controls
            * pin; the chips scroll away so the bar stays one row tall. */}
          <div
            className={cn(
              'sticky top-18 z-30 -mx-5 border-b bg-background/95 px-5 py-2.5 backdrop-blur sm:-mx-8 sm:px-8',
              'lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:pb-4 lg:backdrop-blur-none',
              // On desktop the one divider goes under the chips when there are any.
              activeFilters.length > 0 && 'lg:border-b-0 lg:pb-0',
            )}
          >
            <CatalogToolbar
              {...filterProps}
              total={result.total}
              activeFilterCount={activeFilters.length}
            />
          </div>
          {activeFilters.length > 0 && (
            <div className="pt-3 lg:border-b lg:pb-4">
              <ActiveFilters filters={activeFilters} clearHref={clearHref} />
            </div>
          )}

          {/* Say so when the engine widened a multi-word query rather than
            * passing partial matches off as exact ones. */}
          {result.search?.partial && result.total > 0 && (
            <p className="mt-4 rounded-lg bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
              No product matches every word — showing the closest matches instead.
            </p>
          )}

          {result.total === 0 ? (
            <NoResults
              query={criteria.q}
              options={emptyState}
              categories={emptyCategories}
              hadFilters={hasActiveFilters(criteria)}
            />
          ) : (
            <>
              <div className="pt-5 lg:pt-6">
                <ResultsGrid products={result.items} />
              </div>

              <div className="mt-10 lg:mt-12">
                <Suspense>
                  <Pagination page={result.page} pageCount={result.pageCount} hrefFor={pageHref} />
                </Suspense>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Showing {(result.page - 1) * result.perPage + 1}–
                  {Math.min(result.page * result.perPage, result.total)} of{' '}
                  {result.total.toLocaleString()}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {outro}
    </div>
  );
}
