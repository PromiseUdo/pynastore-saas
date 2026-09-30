import Link from 'next/link';
import { PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

/** The platform's wordmark: a square monogram and the name, both from lib/brand.ts. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn('inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      <span aria-hidden className="flex size-7 items-center justify-center rounded-[7px] bg-foreground text-[13px] font-bold text-background">
        {PLATFORM_NAME.charAt(0)}
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">{PLATFORM_NAME}</span>
    </Link>
  );
}
