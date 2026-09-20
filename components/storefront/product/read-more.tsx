'use client';

/*
 * Collapses long copy on small screens and shows it in full from `sm` up.
 *
 * The content is server-rendered and passed in as children, so the text is
 * always in the HTML — this only decides how much of it is visible. That
 * matters for two reasons: it is in the page for search engines and for
 * anyone without JavaScript, and the collapsed state cannot be wrong on
 * first paint.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ReadMore({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={className}>
      <div
        id="read-more-content"
        className={cn(
          'relative overflow-hidden transition-[max-height] duration-300',
          // The cap and its fade are phone-only; from sm the copy is simply
          // shown, and the toggle below is hidden with it.
          expanded ? 'max-h-none' : 'max-h-40 sm:max-h-none',
        )}
      >
        {children}
        {!expanded && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background to-transparent sm:hidden"
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls="read-more-content"
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal underline-offset-4 hover:underline sm:hidden"
      >
        {expanded ? 'Show less' : 'Read more'}
        <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
      </button>
    </div>
  );
}
