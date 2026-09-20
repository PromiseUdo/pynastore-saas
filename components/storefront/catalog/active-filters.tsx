/*
 * The removable chips under the toolbar.
 *
 * Server component, and the removal targets are plain <Link>s whose hrefs
 * were computed server-side — so chips work before hydration, survive a
 * shared URL, and are middle-clickable like any other link.
 *
 * Horizontally scrollable on mobile rather than wrapping to four rows and
 * pushing the grid off screen.
 */
import Link from 'next/link';
import { X } from 'lucide-react';
import type { ActiveFilter } from '@/lib/storefront/product-discovery';

export function ActiveFilters({
  filters,
  clearHref,
}: {
  filters: ActiveFilter[];
  clearHref: string;
}) {
  if (!filters.length) return null;

  return (
    <div className="sf-no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-0.5">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">Filters:</span>
      {filters.map((filter) => (
        <Link
          key={filter.id}
          href={filter.removeHref}
          scroll={false}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/5 py-1.5 pl-3 pr-2 text-xs font-medium transition-colors hover:bg-brand/10"
        >
          {filter.label}
          <X aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="sr-only">Remove filter</span>
        </Link>
      ))}
      {filters.length > 1 && (
        <Link
          href={clearHref}
          scroll={false}
          className="shrink-0 whitespace-nowrap px-2 text-xs font-semibold text-brand underline-offset-4 hover:underline"
        >
          Clear all
        </Link>
      )}
    </div>
  );
}
