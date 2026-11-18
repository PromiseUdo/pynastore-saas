'use client';

/*
 * "Shop by category" on a phone, labelled "Browse categories": one row that opens into the list of
 * categories, instead of tiles or circles wrapping over several screens —
 * a shop with twenty departments otherwise pushes everything else far down.
 *
 * Each category shows its picture in a small circle, or a neutral stand-in
 * when the merchant hasn't uploaded one, so the list still reads as one set.
 * The list opens OVER the page, like any dropdown, rather than pushing the
 * sections below it down; it scrolls inside itself, and closes on a tap
 * outside it or Escape.
 */
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, ChevronRight, LayoutGrid, Shapes } from 'lucide-react';
import type { Category } from '@/lib/storefront/types';
import { categoryHref } from '@/lib/storefront/nav-types';
import { cn } from '@/lib/utils';

export function CategoryDropdown({ categories, className }: { categories: Category[]; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const root = React.useRef<HTMLDivElement>(null);
  const toggle = React.useRef<HTMLButtonElement>(null);

  // Close on a tap anywhere else, or Escape (focus back on the button).
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <section className={cn('sf-container py-5', className)} aria-label="Browse categories">
      <div ref={root} className="relative">
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground">
            <LayoutGrid className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-semibold leading-tight">Browse categories</span>
            <span className="block text-xs text-muted-foreground">
              {categories.length} {categories.length === 1 ? 'category' : 'categories'}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn('size-5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
          />
        </button>

        <ul
          id={listId}
          hidden={!open}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-[60vh] divide-y overflow-y-auto overscroll-contain rounded-2xl border bg-card shadow-xl"
        >
          {categories.map((cat) => (
            <li key={cat.id}>
              <Link
                href={categoryHref(cat.path)}
                onClick={() => setOpen(false)}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <CategoryAvatar imageUrl={cat.imageUrl} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{cat.name}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/products"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center justify-center px-4 py-2.5 text-sm font-semibold text-brand hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              See all products
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** The category's picture in a circle; without one, a neutral stand-in. */
function CategoryAvatar({ imageUrl }: { imageUrl: string }) {
  return (
    <span aria-hidden className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-tile">
      {imageUrl ? (
        <Image src={imageUrl} alt="" fill sizes="40px" className="object-cover" />
      ) : (
        <Shapes className="size-4 text-muted-foreground" />
      )}
    </span>
  );
}
