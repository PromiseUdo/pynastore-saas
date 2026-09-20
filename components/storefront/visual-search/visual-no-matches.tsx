/*
 * What a visual search offers when it finds nothing.
 *
 * Same principle as <NoResults> on /search: every route out is one that
 * genuinely works — the picker to try another photo, real departments from
 * this store's own tree, and the text search. Nothing here suggests
 * "try again" without giving somewhere to go (§7).
 */
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { ImagePicker } from './image-picker';
import { categoryHref } from '@/lib/storefront/navigation';
import type { Category } from '@/lib/storefront/types';

export function VisualNoMatches({
  categories,
  /** shown when the search failed rather than simply matching nothing */
  message,
}: {
  categories: Category[];
  message?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl py-6 text-center">
      <span
        aria-hidden
        className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <SearchX className="size-5" />
      </span>

      <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
        We couldn’t find close matches.
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
        {message ??
          'Nothing in this store looks close enough to that image to be worth showing. A clearer photo of the item on its own usually works better.'}
      </p>

      <div className="mt-8 text-left">
        <ImagePicker />
      </div>

      {categories.length > 0 && (
        <nav aria-label="Browse departments" className="mt-8">
          <p className="text-sm font-medium">Or browse a department</p>
          <ul className="mt-3 flex flex-wrap justify-center gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={categoryHref(category.path)}
                  className="inline-flex h-10 items-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        Know what it’s called?{' '}
        <Link href="/search" className="font-semibold text-brand underline-offset-4 hover:underline">
          Search by text instead
        </Link>
      </p>
    </div>
  );
}
