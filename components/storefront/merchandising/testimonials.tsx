/*
 * Trust block — customer words plus the brands we stock, in one band.
 *
 * These used to be two separate sections. They're making the same argument
 * ("other people trust this shop"), and splitting it across two full-height
 * bands diluted both.
 *
 * Server component.
 */
import Image from 'next/image';
import Link from 'next/link';
import { Quote, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Brand, Testimonial } from '@/lib/storefront/types';
import { SectionHeader } from '@/components/storefront/common/section-header';

export function Testimonials({
  testimonials,
  brands = [],
}: {
  testimonials: Testimonial[];
  brands?: Brand[];
}) {
  const items = testimonials.slice(0, 3);
  if (!items.length) return null;

  return (
    <section className="sf-band bg-card">
      <div className="sf-container">
        <SectionHeader
          eyebrow="Kind words"
          title="Loved by people who hate shopping online"
          align="center"
        />

        <ul className="grid gap-6 md:grid-cols-3">
          {items.map((t, i) => (
            <li
              key={t.id}
              className={cn(
                'relative flex flex-col rounded-3xl bg-background p-7',
                // The middle card lifts slightly so the row has a focal point
                // rather than reading as three identical boxes.
                i === 1 && 'md:-mt-4 md:shadow-lg md:shadow-foreground/5',
              )}
            >
              <Quote aria-hidden className="size-8 text-highlight" />

              <blockquote className="mt-4 flex-1 text-[0.9375rem] leading-relaxed">
                “{t.quote}”
              </blockquote>

              <div className="mt-6 flex items-center gap-3 border-t border-border pt-5">
                <Image
                  src={t.avatarUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{t.author}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.role}</p>
                </div>
                <span className="flex shrink-0 gap-0.5 text-rating" aria-label={`${t.rating} out of 5`}>
                  {Array.from({ length: t.rating }).map((_, s) => (
                    <Star key={s} className="size-3.5 fill-current" />
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {brands.length > 0 && (
          <div className="mt-16 border-t border-border pt-10">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Stocking the brands you already trust
            </p>
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
              {brands.slice(0, 8).map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/search?q=${encodeURIComponent(b.name)}`}
                    className="font-display text-xl font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {b.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
