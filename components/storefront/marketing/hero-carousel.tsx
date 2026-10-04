'use client';

/*
 * The merchant's own slides, at the top of their homepage.
 *
 * Their words, their pictures. This component picks no copy and supplies no
 * stock imagery: a slide with no picture is a plain panel with the words on
 * it, which is honest and still looks deliberate.
 *
 * It sits ABOVE the discovery hero rather than replacing it — search is how
 * most people actually start, and a shop that writes one slide shouldn't
 * lose it.
 *
 * With one slide there is no carousel at all: no dots, no timer, no JS doing
 * nothing. Several rotate, pause on hover and on focus, and stop entirely for
 * anyone who has asked for less motion.
 *
 * COLOURS HERE ARE FIXED, not theme tokens. "Light text" means white,
 * whatever else is going on: the merchant chose it to read against their own
 * picture, and `text-foreground` would flip to near-white when a shopper puts
 * the storefront in dark mode — light text on a light wash, invisible.
 *
 * The wash behind the words follows their ALIGNMENT too. A left-to-right
 * gradient under centred or right-aligned text leaves them over the clear
 * end of it, which is the other half of the same bug.
 *
 * LAYOUTS (ROADMAP 15.4). `full` is the above: words over a full-width
 * picture. `split` puts the words BESIDE the picture — on the side the slide
 * is aligned to — so they sit on the page itself and use the theme's colours
 * (no wash needed, and light/dark text no longer applies). Same slides, same
 * rotation and pause rules either way.
 */
import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { HeroSlide } from '@/lib/storefront/types';

const ROTATE_MS = 5000;

/**
 * The wash between a merchant's photo and their words.
 *
 * It runs FROM the side the words sit on, so they always land on the solid
 * end of it. Centred words get an even scrim instead of a gradient, because
 * there is no side to run from.
 */
export function scrim(theme: HeroSlide['theme'], align: HeroSlide['align']): string {
  const dark = theme === 'dark';
  if (align === 'center') return dark ? 'bg-black/50' : 'bg-white/60';
  const direction = align === 'right' ? 'bg-gradient-to-l' : 'bg-gradient-to-r';
  return dark
    ? `${direction} from-black/70 via-black/40 to-transparent`
    : `${direction} from-white/80 via-white/50 to-transparent`;
}

export function HeroCarousel({ slides, layout = 'full' }: { slides: HeroSlide[]; layout?: 'full' | 'split' }) {
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  const count = slides.length;

  React.useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [count, paused]);

  if (count === 0) return null;

  const active = slides[Math.min(index, count - 1)];
  const dark = active.theme === 'dark';

  if (layout === 'split') {
    const pictureFirst = active.align === 'right';
    return (
      <section
        aria-label="Featured"
        aria-roledescription={count > 1 ? 'carousel' : undefined}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        className="sf-container sf-section"
      >
        <div className="grid items-center gap-8 md:grid-cols-2 lg:gap-14">
          <div className={cn('order-2', pictureFirst ? 'md:order-2' : 'md:order-1', active.align === 'center' && 'md:text-center')}>
            {active.eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{active.eyebrow}</p>
            )}
            <h2 className="mt-2 font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">{active.title}</h2>
            {active.subtitle && <p className="mt-3 text-base text-muted-foreground">{active.subtitle}</p>}
            {active.ctaHref && active.ctaLabel && (
              <Link
                href={active.ctaHref}
                className="mt-6 inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] bg-brand px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
              >
                {active.ctaLabel}
              </Link>
            )}
          </div>
          <div
            className={cn(
              'relative order-1 aspect-[4/3] overflow-hidden rounded-3xl bg-tile',
              pictureFirst ? 'md:order-1' : 'md:order-2',
            )}
          >
            {slides.map((slide, i) =>
              slide.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={slide.id}
                  src={slide.imageUrl}
                  alt=""
                  aria-hidden={i !== index}
                  className={cn(
                    'absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out',
                    i === index ? 'opacity-100' : 'opacity-0',
                  )}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              ) : null,
            )}
          </div>
        </div>
        {count > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show slide ${i + 1} of ${count}: ${slide.title}`}
                aria-current={i === index}
                className={cn(
                  'size-2.5 rounded-full transition-all',
                  i === index ? 'w-6 bg-foreground' : 'bg-foreground/25 hover:bg-foreground/50',
                )}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Featured"
      aria-roledescription={count > 1 ? 'carousel' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative isolate overflow-hidden bg-tile"
    >
      <div className="relative aspect-[16/9] w-full sm:aspect-[21/9] lg:aspect-[2.8/1]">
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            aria-hidden={i !== index}
            className={cn(
              'absolute inset-0 transition-opacity duration-700 ease-out',
              i === index ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {slide.imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.imageUrl}
                  alt=""
                  className="size-full object-cover"
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
                {/* A wash behind the words, so a merchant's photo can't make
                  * their own headline unreadable — running from whichever
                  * side the words are on. */}
                <div className={cn('absolute inset-0', scrim(slide.theme, slide.align))} />
              </>
            ) : (
              /* No picture: a plain panel. Nothing is borrowed to fill it. */
              <div className={cn('size-full', slide.theme === 'dark' ? 'bg-neutral-900' : 'bg-neutral-100')} />
            )}
          </div>
        ))}

        <div
          className={cn(
            'absolute inset-0 flex items-center',
            active.align === 'center' && 'justify-center text-center',
            active.align === 'right' && 'justify-end text-right',
          )}
        >
          <div className="sf-container">
            <div
              className={cn(
                'max-w-md',
                active.align === 'center' && 'mx-auto',
                active.align === 'right' && 'ml-auto',
                dark ? 'text-white' : 'text-neutral-900',
              )}
            >
              {active.eyebrow && (
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">
                  {active.eyebrow}
                </p>
              )}
              <h2 className="mt-2 font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">
                {active.title}
              </h2>
              {active.subtitle && (
                <p className="mt-3 max-w-sm text-sm opacity-90 sm:text-base">{active.subtitle}</p>
              )}
              {active.ctaHref && active.ctaLabel && (
                <Link
                  href={active.ctaHref}
                  className={cn(
                    'mt-6 inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] px-7 text-sm font-semibold transition-opacity hover:opacity-90',
                    dark ? 'bg-white text-neutral-900' : 'bg-neutral-900 text-white',
                  )}
                >
                  {active.ctaLabel}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {count > 1 && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show slide ${i + 1} of ${count}: ${slide.title}`}
              aria-current={i === index}
              className={cn(
                'size-2.5 rounded-full transition-all',
                i === index ? 'w-6 bg-white' : 'bg-white/50 hover:bg-white/80',
                !dark && (i === index ? 'bg-neutral-900' : 'bg-neutral-900/30 hover:bg-neutral-900/50'),
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
