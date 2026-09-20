/*
 * "← Your orders".
 *
 * A shared component because three detail pages need it and because a back
 * link is a control, not prose: at the 20px its text alone occupied, it was
 * under the 32px a thumb can reliably hit. The negative margins keep it
 * sitting where the eye expects while the tappable box is bigger than the
 * ink.
 */
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}
