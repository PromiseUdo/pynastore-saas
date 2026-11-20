import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "See all …", centred under a band of products.
 *
 * Shoppers decide they want more AFTER looking through a band, by which point
 * a link in the heading is off-screen above them; this one is where they
 * are. Grids use it on every screen; scrolling rows only on phones, where
 * there are no arrows and the heading is cramped (desktop keeps the heading
 * link beside the arrows). Never both on one screen.
 *
 * Outlined and quiet on purpose: it must not compete with "Add to bag" on
 * the cards above it. The label names the destination ("See all best
 * sellers"), so a page of bands doesn't read as five identical links.
 */
export function SeeAllLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <div className={cn('mt-10 flex justify-center', className)}>
      <Link
        href={href}
        className="group inline-flex h-11 max-w-full items-center gap-2 rounded-[var(--sf-radius-button,999px)] border border-border px-6 text-sm font-semibold transition-colors hover:border-brand"
      >
        <span className="truncate">{label}</span>
        <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
