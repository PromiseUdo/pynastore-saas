/*
 * "Powered by Pynastore" — the one place the platform's name appears on a
 * shop (decided by the owner 2026-11-18). It links to the platform's own
 * website, opens in a new tab so the shopper's bag and page stay put, and is
 * drawn in the shop's muted text colour with the Pynastore symbol in its
 * small-size cut (the brand pack's choice under 24px) — 16px, the pack's
 * minimum, so it sits quietly in every look and never competes with the
 * merchant's own brand. On a dark shop the symbol reverses by itself.
 */
import { PLATFORM_DOMAIN, PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { PynastoreSymbol } from '@/components/brand/pynastore-logo';

export const POWERED_BY_HREF = `https://www.${PLATFORM_DOMAIN}/?utm_source=storefront&utm_medium=powered_by`;

export function PoweredBy({ className }: { className?: string }) {
  return (
    <a
      href={POWERED_BY_HREF}
      target="_blank"
      rel="noopener"
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full text-xs text-muted-foreground transition-colors hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <span>Powered by</span>
      <PynastoreSymbol small className="size-4" />
      <span className="font-semibold tracking-tight text-foreground/80 group-hover:text-foreground">{PLATFORM_NAME}</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
