'use client';

/*
 * Choosing a star rating.
 *
 * A real radio group under the stars, not five buttons: it arrives at the
 * right place in the tab order, arrow keys move between the options, and a
 * screen reader announces "3 stars, radio button, 3 of 5" without any of it
 * being described by hand. The stars are the label of each radio, which is
 * why the inputs are visually hidden rather than absent.
 */
import * as React from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RATING_VALUES } from '@/lib/storefront/reviews';

const WORDS: Record<number, string> = {
  1: 'Poor',
  2: 'Not great',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

export function RatingInput({
  name = 'rating',
  defaultValue = 0,
  error,
  describedBy,
}: {
  name?: string;
  defaultValue?: number;
  error?: string;
  describedBy?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const [hovered, setHovered] = React.useState(0);
  const shown = hovered || value;

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Your rating"
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="flex items-center gap-1"
        onMouseLeave={() => setHovered(0)}
      >
        {RATING_VALUES.map((star) => (
          <label
            key={star}
            className="cursor-pointer p-1"
            onMouseEnter={() => setHovered(star)}
            title={`${star} ${star === 1 ? 'star' : 'stars'} — ${WORDS[star]}`}
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => setValue(star)}
              className="sr-only peer"
            />
            <Star
              aria-hidden
              strokeWidth={1.5}
              className={cn(
                'size-7 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 rounded-sm',
                star <= shown ? 'fill-rating text-rating' : 'text-muted-foreground/40',
              )}
            />
            <span className="sr-only">
              {star} {star === 1 ? 'star' : 'stars'} — {WORDS[star]}
            </span>
          </label>
        ))}

        <span className="ml-2 text-sm text-muted-foreground" aria-hidden>
          {shown ? WORDS[shown] : 'Tap a star'}
        </span>
      </div>
    </div>
  );
}
