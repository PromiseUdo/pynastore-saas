'use client';

/*
 * The panel that opens beside a root category in the header's "Categories"
 * dropdown (<CategoryNavBar>).
 *
 * It flattens the tree into ONE dense grid of leaf categories rather than
 * nesting two more levels of menu. Three levels of hover-menu is where
 * mega-menus usually start losing people; the level-1 groupings are still
 * reachable as the chip row above the grid.
 */
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { leafLinks, type NavItem } from '@/lib/storefront/nav-types';

export function CategoryFlyout({
  item,
  onNavigate,
  className,
}: {
  item: NavItem;
  onNavigate?: () => void;
  className?: string;
}) {
  const leaves = leafLinks(item);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* header */}
      <div className="flex items-start gap-4 border-b p-5">
        {item.imageUrl && (
          <Image
            src={item.imageUrl}
            alt=""
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-full bg-tile object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-xl font-bold">{item.name}</h3>
            {item.productCount != null && item.productCount > 0 && (
              <span className="text-xs text-muted-foreground">{item.productCount} products</span>
            )}
          </div>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
          )}
        </div>
        <Link
          href={item.href}
          onClick={onNavigate}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover sm:flex"
        >
          Shop all
          <ArrowRight className="size-4" />
        </Link>
      </div>

      {/* level-1 groupings */}
      {item.columns.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b px-5 py-3">
          {item.columns.map((col) => (
            <Link
              key={col.id}
              href={col.href}
              onClick={onNavigate}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:border-brand hover:text-brand"
            >
              {col.name}
            </Link>
          ))}
        </div>
      )}

      {/* leaf grid */}
      <div className="sf-thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {leaves.map((leaf) => (
            <li key={leaf.id}>
              <Link
                href={leaf.href}
                onClick={onNavigate}
                className="flex items-center gap-3 rounded-xl border border-transparent bg-secondary p-2.5 transition-colors hover:border-brand/40 hover:bg-accent"
              >
                {leaf.imageUrl && (
                  <Image
                    src={leaf.imageUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="size-10 shrink-0 rounded-lg bg-tile object-cover"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{leaf.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {leaf.productCount ? `${leaf.productCount} products` : 'Browse the range'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href={item.href}
          onClick={onNavigate}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-accent sm:hidden"
        >
          Shop all {item.name}
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
