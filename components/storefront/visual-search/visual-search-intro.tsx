/*
 * /search/image with nothing chosen yet.
 *
 * Deliberately not a "developer upload form" (§30): the picker is the page,
 * the supporting copy is one line, and below it are the things a shopper can
 * do if they'd rather not take a photo at all. No card grid, no gradient, no
 * second hero.
 *
 * Server component.
 */
import Link from 'next/link';
import { ImagePicker } from './image-picker';
import { categoryHref } from '@/lib/storefront/navigation';
import type { Category } from '@/lib/storefront/types';

export function VisualSearchIntro({
  storeName,
  categories,
}: {
  storeName: string;
  categories: Category[];
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="text-center">
        <h1 className="text-[1.75rem] leading-tight tracking-tight sm:text-4xl">
          Search with an image
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
          Upload a photo and we’ll find visually similar products from{' '}
          {storeName}.
        </p>
      </header>

      <div className="mt-7">
        <ImagePicker />
      </div>

      {categories.length > 0 && (
        <nav aria-label="Departments" className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">Or start from a department</p>
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
    </div>
  );
}
