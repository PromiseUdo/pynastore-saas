'use client';

/*
 * Homepage hero — editorial, not a carousel-of-billboards.
 *
 * The layout stays PUT between slides: copy left, image right. Only the words
 * and the photograph crossfade. A hero whose whole composition slides sideways
 * every six seconds is the single most common reason people scroll straight
 * past one, and it makes the first paint feel unsettled. Holding the frame
 * still lets the type do the work and keeps the primary CTA in one place.
 *
 * Autoplay pauses on hover and on focus-within, so a keyboard user tabbing to
 * the CTA never has it change under them.
 */
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Star, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HeroSlide, Testimonial } from '@/lib/storefront/types';

const AUTOPLAY_MS = 7000;

/** Wraps the closing word in the highlighter stroke (see `.sf-marker`). */
function MarkedTitle({ title }: { title: string }) {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return <>{title}</>;
  const last = words.pop()!;
  return (
    <>
      {words.join(' ')} <span className="sf-marker">{last}</span>
    </>
  );
}

export function EditorialHero({
  slides,
  testimonials = [],
}: {
  slides: HeroSlide[];
  testimonials?: Testimonial[];
}) {
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused || slides.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  if (!slides.length) return null;
  const slide = slides[index];

  const avatars = testimonials.slice(0, 4);
  const avgRating =
    avatars.length > 0
      ? avatars.reduce((sum, t) => sum + t.rating, 0) / avatars.length
      : 4.9;

  return (
    <section
      aria-label="Featured"
      className="sf-container pb-4 pt-8 lg:pb-10 lg:pt-14"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        {/* ── copy ─────────────────────────────────────────────────────── */}
        <div className="order-2 lg:order-1">
          {/* `key` restarts the rise animation on each slide change. */}
          <div key={slide.id} className="sf-rise">
            <p className="inline-flex items-center gap-2 rounded-full bg-teal-soft px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal">
              <span aria-hidden className="size-1.5 rounded-full bg-teal" />
              {slide.eyebrow}
            </p>

            <h1 className="mt-6 text-[2.75rem] leading-[1.18] sm:text-6xl lg:text-[4.25rem]">
              <MarkedTitle title={slide.title} />
            </h1>

            <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground lg:text-lg">
              {slide.subtitle}
            </p>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={slide.ctaHref}
              className="group inline-flex h-13 items-center gap-2.5 rounded-full bg-brand px-8 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              {slide.ctaLabel}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/products"
              className="inline-flex h-13 items-center rounded-full border border-border px-7 text-sm font-semibold transition-colors hover:border-brand"
            >
              Browse everything
            </Link>
          </div>

          {/* social proof */}
          <div className="mt-9 flex items-center gap-4">
            {avatars.length > 0 && (
              <div className="flex -space-x-2.5">
                {avatars.map((t) => (
                  <Image
                    key={t.id}
                    src={t.avatarUrl}
                    alt=""
                    width={36}
                    height={36}
                    className="size-9 rounded-full border-2 border-background object-cover"
                  />
                ))}
              </div>
            )}
            <div className="text-sm">
              <span className="flex items-center gap-1 text-rating">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-3.5 fill-current" />
                ))}
              </span>
              <p className="mt-0.5 text-muted-foreground">
                <span className="font-semibold text-foreground">{avgRating.toFixed(1)}</span> from
                2,400+ happy shoppers
              </p>
            </div>
          </div>
        </div>

        {/* ── image ────────────────────────────────────────────────────── */}
        <div className="relative order-1 lg:order-2">
          {/* A soft yellow shape peeking out behind the photograph — the one
            * piece of pure decoration on the page, and what stops the hero
            * reading as a plain two-column block. */}
          <div
            aria-hidden
            className="absolute -right-4 -top-6 hidden size-56 rounded-full bg-highlight/70 blur-[2px] lg:block"
          />
          <div
            aria-hidden
            className="absolute -bottom-8 -left-8 hidden size-40 rounded-full bg-teal-soft lg:block"
          />

          <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] bg-tile lg:aspect-[5/4] lg:rounded-[2.5rem]">
            {slides.map((s, i) => (
              <Image
                key={s.id}
                src={s.imageUrl}
                alt={i === index ? s.title : ''}
                fill
                priority={i === 0}
                sizes="(max-width: 1024px) 100vw, 55vw"
                className={cn(
                  'object-cover transition-opacity duration-[900ms] ease-out',
                  i === index ? 'opacity-100' : 'opacity-0',
                )}
              />
            ))}
          </div>

          {/* floating reassurance chip */}
          <div className="absolute -bottom-5 left-5 flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-xl shadow-foreground/10 lg:left-8">
            <span className="flex size-10 items-center justify-center rounded-full bg-highlight text-highlight-foreground">
              <Truck className="size-5" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold">Fast delivery</span>
              <span className="block text-xs text-muted-foreground">2–4 days, nationwide</span>
            </span>
          </div>
        </div>
      </div>

      {/* slide dots — under the copy column on desktop, centred on mobile */}
      {slides.length > 1 && (
        <div className="mt-14 flex justify-center gap-2.5 lg:mt-12 lg:justify-start">
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setIndex(i)}
              aria-label={`Show slide ${i + 1}: ${s.title}`}
              aria-current={i === index}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === index ? 'w-10 bg-brand' : 'w-4 bg-border hover:bg-muted-foreground',
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
