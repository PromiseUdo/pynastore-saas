'use client';

/*
 * What an empty search box offers before anything is typed: the shop's own
 * categories, from the same navigation the header shows. It used to be a
 * fixed "Trending searches" list — invented words, the same in every shop —
 * and we don't record searches, so there is nothing true to call trending.
 * A shop with no categories shows nothing here.
 */
import Link from 'next/link';
import type { NavItem } from '@/lib/storefront/nav-types';

const MAX = 8;

export function SearchShortcuts({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const links = items.filter((item) => item.href && item.name).slice(0, MAX);
  if (!links.length) return null;
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Browse</p>
      <div className="flex flex-wrap gap-2">
        {links.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            onClick={onNavigate}
            className="rounded-[var(--sf-radius-button,999px)] border px-3 py-1.5 text-sm transition-colors hover:border-brand hover:text-brand"
          >
            {item.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
