import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared heading for every homepage band.
 *
 * `eyebrow` carries the small teal kicker, the title runs in the display
 * serif, and the optional link renders as an outlined pill on the right
 * (stacking under the title on narrow screens rather than squeezing).
 */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  href,
  linkLabel = 'View all',
  align = 'left',
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  align?: 'left' | 'center';
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mb-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8',
        align === 'center' && 'sm:flex-col sm:items-center sm:text-center',
        className,
      )}
    >
      <div className={cn('min-w-0', align === 'center' && 'max-w-2xl')}>
        {eyebrow && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-teal">
            {eyebrow}
          </p>
        )}
        <h2 className="text-3xl leading-[1.1] lg:text-[2.5rem]">{title}</h2>
        {subtitle && (
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>

      {(children || href) && (
        <div className="flex shrink-0 items-center gap-3">
          {children}
          {href && (
            <Link
              href={href}
              className="group inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold transition-colors hover:border-brand"
            >
              {linkLabel}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
