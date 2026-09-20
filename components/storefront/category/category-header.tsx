/*
 * The top of a category page.
 *
 * Two deliberately different treatments, because a department and a leaf are
 * not the same arrival:
 *
 *  - A ROOT category (Fashion, Electronics) gets a banner: it is usually the
 *    first page of a session, often reached from an ad or the mega-menu, and
 *    the image is what says "you are in the right shop".
 *  - Everything deeper gets an editorial header — no image. Someone on
 *    "Skirts" has already decided; a 400px photograph between them and the
 *    skirts is a toll, not a welcome.
 *
 * Either way the product count and the first row of products stay close to
 * the top, which is the rule the giant-hero pattern breaks.
 */
import Image from 'next/image';
import type { Category } from '@/lib/storefront/types';

export function CategoryHeader({
  category,
  productCount,
  /** rendered under the copy — the search-within field */
  children,
}: {
  category: Category;
  productCount: number;
  children?: React.ReactNode;
}) {
  const count = `${productCount.toLocaleString()} ${productCount === 1 ? 'product' : 'products'}`;

  if (category.level === 0) {
    return (
      <header className="relative overflow-hidden rounded-[1.5rem] bg-tile">
        <div className="absolute inset-0">
          {category.imageUrl && (
            <Image src={category.imageUrl} alt="" fill priority sizes="100vw" className="object-cover" />
          )}
          {/* A single flat scrim rather than a gradient stack: it keeps the
            * text legible over whatever photography a merchant uploads. */}
          <span aria-hidden className="absolute inset-0 bg-[#001822]/60" />
        </div>

        <div className="relative px-6 py-10 sm:px-10 sm:py-14 lg:py-16">
          <div className="max-w-2xl text-[color:var(--primary-foreground)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
              {count}
            </p>
            <h1 className="mt-3 font-display text-3xl leading-[1.1] sm:text-4xl lg:text-5xl">
              {category.name}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed opacity-90 sm:text-base">
              {category.description}
            </p>
          </div>
          {children && <div className="relative mt-2">{children}</div>}
        </div>
      </header>
    );
  }

  return (
    <header className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">{count}</p>
      <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight sm:text-4xl">
        {category.name}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{category.description}</p>
      {children}
    </header>
  );
}
