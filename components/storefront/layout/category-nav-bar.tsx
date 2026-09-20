'use client';

/*
 * The row under the header: the "All Categories" button on the left and the
 * primary nav on the right.
 *
 * The dropdown is plain `useState` + an absolutely-positioned panel anchored
 * to the sticky <header> (its nearest positioned ancestor) — deliberately not
 * Radix NavigationMenu, whose Viewport needs a ResizeObserver and rendered a
 * zero-height panel here. Dismissal is wired to pointerdown / Escape / scroll
 * / route change.
 */
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/lib/storefront/nav-types';
import { usePublicPathname } from '@/lib/storefront/use-public-pathname';
import { CategoryFlyout } from './category-flyout';

/* Every one of these has a route. "Brands" had no page, and "Our story" and
 * "Contact" pointed at content nothing in this app writes yet. */
const PRIMARY_LINKS = [
  { href: '/collections/new-arrivals', label: 'New in' },
  { href: '/collections', label: 'Collections' },
  { href: '/sale', label: 'Deals' },
];

export function CategoryNavBar({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePublicPathname();
  const [open, setOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Only roots with a real subtree belong in the category rail — the synthetic
  // "New in"/"Sale" nav entries carry no columns and live in PRIMARY_LINKS.
  const roots = React.useMemo(() => navItems.filter((i) => i.columns.length > 0), [navItems]);
  const active = roots.find((r) => r.id === activeId) ?? roots[0];

  // Close on route change — the panel outlives the navigation otherwise.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('[data-sf-categories]')) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll);
    };
  }, [open]);

  return (
    <div className="hidden border-t border-border/60 lg:block" data-sf-categories>
      <div className="sf-container flex items-center gap-2">
        {/* Sits in the same visual register as its sibling links. The old
          * solid-dark pill read as a second logo and was the heaviest thing
          * on a page whose whole point is calm. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
          data-state={open ? 'open' : 'closed'}
          className={cn(
            '-ml-3 flex shrink-0 items-center gap-2 px-3 py-4 text-sm font-semibold transition-colors hover:text-teal',
            open && 'text-teal',
          )}
        >
          <LayoutGrid className="size-4" />
          Categories
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>

        <nav aria-label="Primary" className="flex items-center gap-1">
          {PRIMARY_LINKS.map((link) => {
            // Compare paths only — several links carry a `?sort=` that the
            // pathname never contains, so a raw equality check could never
            // mark them active.
            const isActive = pathname === link.href.split('?')[0];
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative px-3 py-4 text-sm font-medium transition-colors hover:text-brand',
                  isActive ? 'text-brand' : 'text-foreground/85',
                )}
              >
                {link.label}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-2.5 h-0.5 rounded-full bg-brand"
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {open && active && (
        <div className="sf-fade-in absolute inset-x-0 top-full z-40 border-t bg-background shadow-2xl shadow-foreground/10">
          <div className="sf-container">
            <div className="grid max-h-[70vh] grid-cols-[17rem_1fr]">
              <ul
                aria-label="Categories"
                className="sf-thin-scrollbar overflow-y-auto border-r py-2"
              >
                {roots.map((root) => (
                  <li key={root.id}>
                    {/*
                      Hovering swaps the pane; clicking navigates to the
                      category. Both are wired so a pointer user never has to
                      click twice and a keyboard user can tab straight through.
                    */}
                    <Link
                      href={root.href}
                      onMouseEnter={() => setActiveId(root.id)}
                      onFocus={() => setActiveId(root.id)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
                        root.id === active.id
                          ? 'bg-accent font-semibold text-brand'
                          : 'hover:bg-accent/60',
                      )}
                    >
                      {root.imageUrl && (
                        <Image
                          src={root.imageUrl}
                          alt=""
                          width={28}
                          height={28}
                          className="size-7 shrink-0 rounded-md bg-tile object-cover"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{root.name}</span>
                      <ChevronRight className="size-4 shrink-0 opacity-50" />
                    </Link>
                  </li>
                ))}
              </ul>

              <CategoryFlyout item={active} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
