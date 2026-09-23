/*
 * "Search by image", wherever discovery is offered.
 *
 * One component so the homepage hero, the search page, the mobile search
 * sheet and the header's own search pill cannot drift into four different
 * labels for the same route (§8, §9). It is a real <Link> to a real page —
 * not a modal, not a launcher — because visual search is one of the store's
 * discovery methods, not a floating assistant bolted onto the corner of the
 * screen.
 *
 * Server-safe; no state of its own.
 */
import Link from 'next/link';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VISUAL_SEARCH_PATH } from '@/lib/storefront/visual-search/query';

export function ImageSearchLink({
  variant = 'pill',
  label = 'Search by image',
  className,
  onNavigate,
}: {
  /** `pill` matches the hero's secondary actions; `row` is a list item in a
   *  sheet; `quiet` is an inline text link beside a search field; `icon` is
   *  the camera inside the header's search box, where there is no room for
   *  words — the label becomes its accessible name instead */
  variant?: 'pill' | 'row' | 'quiet' | 'icon';
  label?: string;
  className?: string;
  /** for surfaces that must close themselves on navigation (the search sheet) */
  onNavigate?: () => void;
}) {
  const styles = {
    pill: 'inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold transition-colors hover:border-brand',
    row: 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent',
    quiet:
      'inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline-offset-4 hover:underline',
    icon: 'flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-brand',
  }[variant];

  return (
    <Link
      href={VISUAL_SEARCH_PATH}
      onClick={onNavigate}
      title={variant === 'icon' ? label : undefined}
      aria-label={variant === 'icon' ? label : undefined}
      className={cn(styles, className)}
    >
      <ImageUp aria-hidden className="size-4" />
      {variant !== 'icon' && label}
    </Link>
  );
}
