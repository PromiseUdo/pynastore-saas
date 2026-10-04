/*
 * "Shop by category" — the primary wayfinding band, placed directly under the
 * hero because on a multi-category store it is the fastest route out of the
 * homepage for someone who already knows roughly what they want.
 *
 * Three layouts (ROADMAP 15.4), the same categories in each: `tiles` (big
 * square pictures — the original), `circles` (small round pictures, more
 * per row) and `list` (names only, for a shop without category pictures).
 *
 * Server component; no interactivity beyond the links.
 */
import Image from 'next/image';
import Link from 'next/link';
import type { Category } from '@/lib/storefront/types';
import { categoryHref } from '@/lib/storefront/navigation';
import { SectionHeader } from '@/components/storefront/common/section-header';

export type CategoryShowcaseVariant = 'tiles' | 'circles' | 'list';

export function CategoryShowcase({
  categories,
  variant = 'tiles',
}: {
  categories: Category[];
  variant?: CategoryShowcaseVariant;
}) {
  if (!categories.length) return null;

  if (variant === 'circles' || variant === 'list') {
    return (
      <section className="sf-container sf-section">
        <SectionHeader title="Shop by category" href="/collections" linkLabel="Browse collections" />
        {variant === 'circles' ? (
          <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
            {categories.map((cat) => (
              <li key={cat.id}>
                <Link href={categoryHref(cat.path)} className="group block text-center">
                  <span className="relative mx-auto block aspect-square w-full max-w-36 overflow-hidden rounded-full bg-tile">
                    {cat.imageUrl && (
                      <Image
                        src={cat.imageUrl}
                        alt=""
                        fill
                        sizes="(max-width:640px) 30vw, 140px"
                        className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                      />
                    )}
                  </span>
                  <span className="mt-3 block text-sm font-semibold leading-snug transition-colors group-hover:text-teal">
                    {cat.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-wrap gap-2.5">
            {categories.map((cat) => (
              <li key={cat.id}>
                <Link
                  href={categoryHref(cat.path)}
                  className="inline-flex h-11 items-center rounded-[var(--sf-radius-button,999px)] border bg-card px-5 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
                >
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="sf-container sf-section">
      <SectionHeader
        eyebrow="Browse"
        title="Shop by category"
        /* No count and no claim: the number of departments is the
          * merchant's, and the tiles below already show it. */
        subtitle="Everything goes into one basket and one checkout."
        href="/collections"
        linkLabel="Browse collections"
      />

      <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map((cat, i) => (
          <li key={cat.id}>
            <Link href={categoryHref(cat.path)} className="group block text-center">
              <span className="relative block overflow-hidden rounded-[calc(1.75rem*var(--sf-radius-scale,1))] bg-tile">
                <span className="relative block aspect-square">
                  {/* A merchant may not have uploaded a picture yet — the
                    * tile colour stands in rather than a broken image. */}
                  {cat.imageUrl && (
                    <Image
                      src={cat.imageUrl}
                      alt=""
                      fill
                      sizes="(max-width:640px) 45vw, (max-width:1024px) 30vw, 22vw"
                      priority={i < 4}
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                    />
                  )}
                </span>
                {/* A wash that deepens on hover — keeps the tiles feeling like
                  * one set even though the photography behind them varies. */}
                <span
                  aria-hidden
                  className="absolute inset-0 bg-brand/0 transition-colors duration-300 group-hover:bg-brand/15"
                />
              </span>
              <span className="mt-4 block text-[0.9375rem] font-semibold leading-snug transition-colors group-hover:text-teal">
                {cat.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
