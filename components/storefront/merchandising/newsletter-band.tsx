/*
 * Closing call to action — an ink slab at the foot of the page.
 *
 * The only other full-bleed colour block is the yellow deal band much higher
 * up, so the two bookend the cream sections rather than competing.
 */
import { Mail } from 'lucide-react';
import { NewsletterSignup } from '@/components/storefront/layout/newsletter-signup';

export function NewsletterBand() {
  return (
    <section className="sf-band bg-brand text-primary-foreground">
      <div className="sf-container">
        <div className="mx-auto max-w-2xl text-center">
          <span
            aria-hidden
            className="mx-auto flex size-14 items-center justify-center rounded-full bg-highlight text-highlight-foreground"
          >
            <Mail className="size-6" />
          </span>

          <h2 className="mt-7 text-3xl leading-[1.3] text-primary-foreground lg:text-[2.5rem]">
            Get <span className="sf-marker">10% off</span> your first
            order
          </h2>

          <p className="mx-auto mt-4 max-w-md text-[0.9375rem] leading-relaxed text-primary-foreground/70">
            Early access to new arrivals, members-only sales, and the occasional genuinely useful
            email. Nothing else.
          </p>

          <NewsletterSignup tone="inverse" className="mx-auto mt-8 max-w-md" />

          <p className="mt-4 text-xs text-primary-foreground/50">
            No spam. Unsubscribe any time.
          </p>
        </div>
      </div>
    </section>
  );
}
