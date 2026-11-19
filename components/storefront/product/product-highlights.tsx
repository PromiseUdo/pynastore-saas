'use client';

/*
 * The product's highlights beside the buy button: the first five, and the
 * rest behind "Read more" / "Show less" — the same control as the
 * description below, so a long list doesn't push delivery and returns off
 * the screen. Every highlight is in the HTML either way; the extra ones are
 * only hidden.
 */
import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const HIGHLIGHTS_SHOWN = 5;

export function ProductHighlights({ highlights, className }: { highlights: string[]; className?: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();
  if (highlights.length === 0) return null;
  const folds = highlights.length > HIGHLIGHTS_SHOWN;

  return (
    <div className={className}>
      <ul id={listId} className="space-y-2 text-sm">
        {highlights.map((highlight, index) => (
          <li
            key={highlight}
            hidden={folds && !expanded && index >= HIGHLIGHTS_SHOWN}
            className="flex items-start gap-2.5 text-muted-foreground"
          >
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
            {highlight}
          </li>
        ))}
      </ul>
      {folds && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal underline-offset-4 hover:underline"
        >
          {expanded ? 'Show less' : 'Read more'}
          <ChevronDown aria-hidden className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}
