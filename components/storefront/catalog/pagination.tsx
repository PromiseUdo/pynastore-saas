/*
 * Pager.
 *
 * Links, not buttons: each page is a real URL, so it is shareable, indexable
 * and works with the back button. Chosen over infinite scroll deliberately —
 * a shopper who opens a product and comes back should land where they were,
 * which infinite scroll loses without a lot of machinery.
 *
 * Windowed with ellipses so a 40-page result set doesn't render 40 links.
 */
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** [1, '…', 4, 5, 6, '…', 20] — always first, last and the current neighbourhood. */
export function pageWindow(current: number, total: number, span = 1): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total]);
  for (let p = current - span; p <= current + span; p++) {
    if (p > 1 && p < total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push('…');
    out.push(page);
    previous = page;
  }
  return out;
}

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  const base =
    'flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm transition-colors sm:h-10 sm:min-w-10';

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-2 sm:flex-wrap">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={cn(base, 'hover:border-brand hover:text-brand')}>
          <ChevronLeft className="size-4" />
          <span className="sr-only sm:not-sr-only sm:ml-1">Previous</span>
        </Link>
      ) : (
        <span aria-disabled className={cn(base, 'opacity-40')}>
          <ChevronLeft className="size-4" />
          <span className="sr-only sm:not-sr-only sm:ml-1">Previous</span>
        </span>
      )}

      {/* Prev + seven windowed pages + next is ~420px — two rows on a phone.
        * There it collapses to prev / "Page 3 of 12" / next; the numbers
        * stay in the DOM from sm up. */}
      <span className="px-3 text-sm tabular-nums text-muted-foreground sm:hidden">
        Page <span className="font-semibold text-foreground">{page}</span> of {pageCount}
      </span>

      {pageWindow(page, pageCount).map((entry, i) =>
        entry === '…' ? (
          <span key={`gap-${i}`} aria-hidden className="hidden px-1 text-muted-foreground sm:inline">
            …
          </span>
        ) : (
          <Link
            key={entry}
            href={hrefFor(entry)}
            aria-current={entry === page ? 'page' : undefined}
            aria-label={`Page ${entry}`}
            className={cn(
              base,
              'hidden sm:flex',
              entry === page
                ? 'border-brand bg-brand font-semibold text-primary-foreground'
                : 'hover:border-brand hover:text-brand',
            )}
          >
            {entry}
          </Link>
        ),
      )}

      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} rel="next" className={cn(base, 'hover:border-brand hover:text-brand')}>
          <span className="sr-only sm:not-sr-only sm:mr-1">Next</span>
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span aria-disabled className={cn(base, 'opacity-40')}>
          <span className="sr-only sm:not-sr-only sm:mr-1">Next</span>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
