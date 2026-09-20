/*
 * Empty state.
 *
 * The rule here: never offer a way out that leads to a second empty page.
 * Every suggestion below was checked against the catalogue by
 * `getEmptyStateOptions()` before it reached this component, and the category
 * links are real departments with stock behind them. No invented
 * "recommended products", no "did you mean" for a term nothing matches.
 *
 * The assistant is offered last and holds to the same rule — it checks what
 * relaxing a query actually returns before suggesting it, and quotes the real
 * lowest price when a budget is what's blocking the search.
 */
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { AssistantLauncher } from '@/components/storefront/assistant/assistant-launcher';
import { categoryHref } from '@/lib/storefront/navigation';
import type { EmptyStateOptions } from '@/lib/storefront/product-discovery';
import type { Category } from '@/lib/storefront/types';

export function NoResults({
  query,
  options,
  categories,
  hadFilters,
}: {
  query?: string;
  options: EmptyStateOptions;
  categories: Category[];
  hadFilters: boolean;
}) {
  const { withoutFilters, broaderQuery } = options;

  return (
    <div className="mx-auto max-w-lg py-12 text-center sm:py-16">
      <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-secondary">
        <SearchX aria-hidden className="size-6 text-muted-foreground" />
      </span>

      <h2 className="text-xl font-semibold">
        {query ? <>No results for “{query}”</> : 'No products match these filters'}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {hadFilters
          ? 'We couldn’t find an exact match. Your filters may be narrowing things too far.'
          : 'We couldn’t find an exact match for that.'}
      </p>

      {(withoutFilters || broaderQuery) && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {withoutFilters && (
            <Link
              href={withoutFilters.href}
              scroll={false}
              className="h-11 rounded-full bg-brand px-5 text-sm font-semibold leading-[2.75rem] text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              Clear filters ({withoutFilters.total})
            </Link>
          )}
          {broaderQuery && (
            <Link
              href={broaderQuery.href}
              scroll={false}
              className="h-11 rounded-full border px-5 text-sm font-semibold leading-[2.75rem] transition-colors hover:border-brand hover:text-brand"
            >
              Search “{broaderQuery.term}” instead ({broaderQuery.total})
            </Link>
          )}
        </div>
      )}

      {/* Can't find it? The assistant can take the request in words and
        * narrow it against the catalogue turn by turn. */}
      <div className="mt-6 rounded-2xl border bg-card p-5">
        <p className="text-sm font-semibold">Can’t find what you’re looking for?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe it in your own words and our shopping assistant will search the store for you.
        </p>
        <AssistantLauncher
          className="mt-4"
          variant="button"
          label="Ask the shopping assistant"
          seed={{ surface: 'search', searchQuery: query, initialMessage: query }}
        />
      </div>

      <div className="mt-6 rounded-2xl border bg-card p-5 text-left">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Try</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          {hadFilters && <li>• Removing a filter or widening the price range</li>}
          {query && query.trim().split(/\s+/).length > 1 && <li>• Using fewer words</li>}
          <li>• Checking the spelling</li>
          <li>• Browsing a department below</li>
        </ul>
      </div>

      {categories.length > 0 && (
        <div className="mt-6">
          <p className="mb-3 text-sm font-medium">Browse categories</p>
          <div className="flex flex-wrap justify-center gap-2">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={categoryHref(category.path)}
                className="rounded-full border px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
              >
                {category.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
