import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * The public site's calls to action: pill-shaped and larger than the
 * dashboard's buttons. `tone="sun"` is for the green closing band, where a
 * green button would disappear.
 */
export function PrimaryCta({
  href,
  children,
  className,
  tone = 'green',
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  tone?: 'green' | 'sun';
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        tone === 'green'
          ? 'bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_8px_20px_-8px_rgba(14,107,71,0.6)] hover:bg-[#0b5a3b] focus-visible:ring-ring'
          : 'bg-mk-sun text-[#11211a] hover:bg-[#f5b85a] focus-visible:ring-mk-sun focus-visible:ring-offset-mk-deep',
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export function SecondaryCta({
  href,
  children,
  className,
  tone = 'default',
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  tone?: 'default' | 'light';
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-12 items-center justify-center rounded-full border px-6 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        tone === 'default'
          ? 'border-foreground/15 bg-card text-foreground hover:border-foreground/30 focus-visible:ring-ring'
          : 'border-white/25 text-white hover:bg-white/10 focus-visible:ring-white/60 focus-visible:ring-offset-mk-deep',
        className,
      )}
    >
      {children}
    </Link>
  );
}
