'use client';

/*
 * "This was helpful" — and pressing it again to take it back.
 *
 * The count moves as soon as it's pressed and is corrected by whatever the
 * server says, so the button answers immediately without ever being able to
 * drift away from the real number. A guest is told to sign in rather than
 * shown a button that does nothing: votes have to belong to someone, or the
 * most helpful review is whoever clicked the most.
 */
import * as React from 'react';
import { ThumbsUp } from 'lucide-react';
import { useShopper } from '@/lib/storefront/context';
import { markHelpfulAction } from '@/features/shop-reviews/actions';
import { cn } from '@/lib/utils';

export function ReviewHelpfulButton({
  reviewId,
  helpful,
  voted,
  isOwn,
}: {
  reviewId: string;
  helpful: number;
  voted: boolean;
  isOwn: boolean;
}) {
  const shopper = useShopper();
  const [count, setCount] = React.useState(helpful);
  const [mine, setMine] = React.useState(voted);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  /* Your own review: the count still belongs on screen, the button doesn't. */
  if (isOwn) {
    return count > 0 ? (
      <span className="inline-flex items-center gap-1">
        <ThumbsUp aria-hidden className="size-3.5" />
        {count} found this helpful
      </span>
    ) : null;
  }

  if (!shopper) {
    return (
      <a
        href="/account/sign-in"
        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      >
        <ThumbsUp aria-hidden className="size-3.5" />
        {count > 0 ? `${count} found this helpful` : 'Helpful?'}
      </a>
    );
  }

  const press = () => {
    const next = !mine;
    setMine(next);
    setCount((n) => Math.max(0, n + (next ? 1 : -1)));
    setError(null);

    startTransition(async () => {
      const result = await markHelpfulAction(reviewId);
      if (result.ok) {
        setMine(result.voted);
        setCount(result.helpful);
      } else {
        setMine(!next);
        setCount((n) => Math.max(0, n + (next ? -1 : 1)));
        setError(result.message);
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={press}
        disabled={pending}
        aria-pressed={mine}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 transition-colors hover:bg-secondary disabled:opacity-60',
          mine && 'border-brand text-brand',
        )}
      >
        <ThumbsUp aria-hidden className={cn('size-3.5', mine && 'fill-brand/20')} />
        {mine ? 'Helpful' : 'Helpful?'}
        {count > 0 && <span className="tabular-nums">({count})</span>}
      </button>
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
