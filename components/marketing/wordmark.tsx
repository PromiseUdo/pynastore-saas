import Link from 'next/link';
import { PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

/** The platform's mark: the name's first letter on a green tile with a saffron corner, and the name — both from lib/brand.ts. */
export function Wordmark({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'light' }) {
  return (
    <Link
      href="/"
      className={cn('inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <span aria-hidden className="relative flex size-8 items-center justify-center overflow-hidden rounded-[9px] bg-primary">
        <span className="font-mk-display text-[17px] font-bold leading-none text-primary-foreground">{PLATFORM_NAME.charAt(0)}</span>
        <span className="absolute -right-1.5 -top-1.5 size-3.5 rounded-full bg-mk-sun" />
      </span>
      <span className={cn('font-mk-display text-[19px] font-semibold tracking-[-0.02em]', tone === 'light' ? 'text-white' : 'text-foreground')}>
        {PLATFORM_NAME}
      </span>
    </Link>
  );
}
