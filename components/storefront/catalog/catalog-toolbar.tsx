'use client';

/*
 * The bar above the grid: result count, sort, and — below lg — the button
 * that opens the filter sheet.
 *
 * Mobile gets a sheet rather than a shrunken sidebar because filtering on a
 * phone is a deliberate, modal task; inlining the same panel above the grid
 * would push the products the shopper came for off the first screen.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SheetRoot,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { FilterPanel, type FilterPanelProps } from './filter-panel';
import {
  SORT_OPTIONS,
  buildHref,
  clearFilters,
  hasActiveFilters,
  patchCriteria,
} from '@/lib/storefront/discovery-url';
import type { SortKey } from '@/lib/storefront/types';

export function CatalogToolbar({
  total,
  activeFilterCount,
  ...filters
}: FilterPanelProps & { total: number; activeFilterCount: number }) {
  const { criteria, optionIndex, pathname } = filters;
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const go = (href: string) => startTransition(() => router.push(href, { scroll: false }));

  return (
    /* On a phone the count, the Filters button and a "Sort: Price: low to
     * high" select don't fit on one 335px line, so the two controls share a
     * row as equal halves and the count moves up to a line of its own. */
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p aria-live="polite" className="w-full text-sm text-muted-foreground sm:w-auto">
        <span className="font-semibold text-foreground">{total.toLocaleString()}</span>{' '}
        {total === 1 ? 'product' : 'products'}
      </p>

      <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
        {/* Filters live in a sheet below lg; the sidebar takes over above it. */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand sm:h-10 sm:flex-none lg:hidden"
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>

        <label className="sr-only" htmlFor="sort-select">Sort products</label>
        {/* A native <select> on purpose: it gets the platform picker on a
          * phone, which is faster and more accessible than any popover. */}
        <select
          id="sort-select"
          value={criteria.sort}
          disabled={pending}
          onChange={(e) =>
            go(buildHref(pathname, patchCriteria(criteria, { sort: e.target.value as SortKey }), optionIndex))
          }
          className={cn(
            'h-11 min-w-0 flex-1 cursor-pointer truncate rounded-full border bg-card pl-4 pr-8 text-sm font-medium outline-none transition-colors focus:border-brand sm:h-10 sm:flex-none',
            pending && 'opacity-60',
          )}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Sort: {option.label}
            </option>
          ))}
        </select>
      </div>

      <SheetRoot open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="flex w-full max-w-sm flex-col gap-0 p-0"
        >
          <div className="flex items-center justify-between border-b px-5 py-4">
            <SheetTitle className="text-base font-semibold">Filters</SheetTitle>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close filters"
              className="rounded-md p-1.5 transition-colors hover:bg-accent"
            >
              <X className="size-5" />
            </button>
          </div>
          <SheetDescription className="sr-only">
            Narrow these results by price, brand, options, rating and availability.
          </SheetDescription>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Changes apply immediately and the sheet closes, so the shopper
              * sees the effect straight away. There is no "Apply" step to
              * forget — "Show results" below just dismisses. */}
            <FilterPanel {...filters} onNavigate={() => setSheetOpen(false)} />
          </div>

          <div className="flex items-center gap-3 border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              disabled={!hasActiveFilters(criteria)}
              onClick={() => {
                setSheetOpen(false);
                go(buildHref(pathname, clearFilters(criteria), optionIndex));
              }}
              className="h-11 flex-1 rounded-full border text-sm font-semibold transition-colors hover:border-brand hover:text-brand disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="h-11 flex-1 rounded-full bg-brand text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              Show {total.toLocaleString()} {total === 1 ? 'result' : 'results'}
            </button>
          </div>
        </SheetContent>
      </SheetRoot>
    </div>
  );
}
