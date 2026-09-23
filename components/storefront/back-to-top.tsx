'use client';

import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePageScrolled } from '@/lib/storefront/use-page-scrolled';

export function BackToTop() {
  /* Shared with the floating assistant launcher, which moves aside for this
   * button at exactly the same moment. */
  const show = usePageScrolled();

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      className={cn(
        'sf-back-to-top fixed bottom-5 right-5 z-20 rounded-full border bg-background p-3 shadow-md transition-all hover:bg-accent',
        'lg:bottom-6 lg:right-6',
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
    >
      <ArrowUp className="size-4" />
    </button>
  );
}
