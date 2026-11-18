/*
 * "Powered by Pynastore" — the one place the platform's name appears on a
 * shop (decided by the owner 2026-11-18). It links to the platform's own
 * website, opens in a new tab so the shopper's bag and page stay put, and is
 * drawn in the shop's muted text colour with a small copy of the platform's
 * mark (the green tile with its saffron corner, as on pynastore.com) — a
 * 16px logo, so it sits quietly in every look and never competes with the
 * merchant's own brand.
 */
import { PLATFORM_DOMAIN, PLATFORM_MARK_COLORS, PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

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
      {/* The mark from components/marketing/wordmark.tsx at half size. */}
      <span
        aria-hidden
        className="relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4.5px] text-[9px] font-bold leading-none"
        style={{ backgroundColor: PLATFORM_MARK_COLORS.tile, color: PLATFORM_MARK_COLORS.letter }}
      >
        {PLATFORM_NAME.charAt(0)}
        <span
          className="absolute -right-[3px] -top-[3px] size-[7px] rounded-full"
          style={{ backgroundColor: PLATFORM_MARK_COLORS.corner }}
        />
      </span>
      <span className="font-semibold tracking-tight text-foreground/80 group-hover:text-foreground">{PLATFORM_NAME}</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
