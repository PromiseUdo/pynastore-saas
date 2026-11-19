import Link from 'next/link';
import { PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { PynastoreLogo } from '@/components/brand/pynastore-logo';

/**
 * The platform's logo, linking home: the brand pack's primary horizontal
 * logo (components/brand/pynastore-logo.tsx). `light` is the reversed
 * colourway, for green or dark backgrounds.
 */
export function Wordmark({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'light' }) {
  return (
    <Link
      href="/"
      aria-label={`${PLATFORM_NAME} home`}
      className={cn('inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      {/* 28px tall: above the pack's 24px minimum for the full logo. */}
      <PynastoreLogo className="h-7" tone={tone === 'light' ? 'reverse' : 'colour'} title="" />
    </Link>
  );
}
