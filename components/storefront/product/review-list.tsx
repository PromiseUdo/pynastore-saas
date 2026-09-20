'use client';

/*
 * Shows the first few reviews and reveals the rest on request.
 *
 * The reviews themselves are server-rendered and handed in as elements — this
 * component only decides how many are on screen. So the text ships in the
 * HTML (good for search engines, and correct before hydration), and no
 * request is made to "load more".
 */
import * as React from 'react';

const INITIAL = 4;

export function ReviewList({
  reviews,
  total,
}: {
  reviews: React.ReactNode[];
  /** total reviews this product has, including ones not rendered here */
  total: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? reviews : reviews.slice(0, INITIAL);
  const hidden = reviews.length - visible.length;

  return (
    <>
      <div className="space-y-6">{visible}</div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-6 h-11 w-full rounded-full border text-sm font-semibold transition-colors hover:border-brand hover:text-brand sm:w-auto sm:px-6"
        >
          Show {hidden} more {hidden === 1 ? 'review' : 'reviews'}
        </button>
      )}

      {total > reviews.length && (
        <p className="mt-4 text-xs text-muted-foreground">
          Showing {reviews.length} of {total.toLocaleString()} written reviews.
        </p>
      )}
    </>
  );
}
