/*
 * Subcategory navigation.
 *
 * Two shapes for one list, chosen by how much room the children have to
 * earn:
 *
 *  - `cards` — thumbnail tiles, for a department with a handful of children.
 *    Worth the space: at this depth the shopper is still choosing an aisle.
 *  - `chips` — a compact scrollable rail, for deep levels and for the
 *    sideways move between siblings. On a phone the rail bleeds off the edge
 *    so it reads as scrollable rather than truncated.
 *
 * Counts are real (see getCategoryLanding) and children with nothing behind
 * them never reach this component, so no chip here leads to an empty grid.
 */
import Image from 'next/image';
import Link from 'next/link';
import { categoryHref } from '@/lib/storefront/navigation';
import type { CategoryChild } from '@/lib/storefront/product-discovery';

export function SubcategoryNav({
  categories,
  variant = 'chips',
  title,
}: {
  categories: CategoryChild[];
  variant?: 'cards' | 'chips';
  title: string;
}) {
  if (!categories.length) return null;

  if (variant === 'cards') {
    return (
      <nav aria-label={title} className="mt-8">
        <h2 className="sr-only">{title}</h2>
        <ul className="sf-no-scrollbar -mx-5 flex gap-4 overflow-x-auto px-5 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {categories.map((category) => (
            <li key={category.id} className="w-36 shrink-0 sm:w-auto">
              <Link
                href={categoryHref(category.path)}
                className="group flex flex-col gap-3 sm:flex-row sm:items-center"
              >
                <span className="relative block size-36 shrink-0 overflow-hidden rounded-2xl bg-tile sm:size-16">
                  {category.imageUrl && (
                    <Image
                      src={category.imageUrl}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 9rem, 4rem"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold transition-colors group-hover:text-teal">
                    {category.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {category.productCount.toLocaleString()}{' '}
                    {category.productCount === 1 ? 'item' : 'items'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={title} className="mt-6">
      <h2 className="sr-only">{title}</h2>
      <ul className="sf-no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {categories.map((category) => (
          <li key={category.id} className="shrink-0">
            <Link
              href={categoryHref(category.path)}
              // 44px tall: a chip rail is tapped far more often than clicked.
              className="flex h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-colors hover:border-brand hover:text-brand"
            >
              {category.name}
              <span className="text-xs text-muted-foreground">{category.productCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
