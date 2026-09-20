'use client';

/*
 * Writing a review of something you bought.
 *
 * The form only exists for a shopper the server has already found a
 * delivered order for (see lib/storefront/reviews/read.ts) — it is not a
 * form that asks and then refuses. It starts collapsed behind one button so
 * the reviews themselves stay the point of the section.
 *
 * Editing reuses the same form, filled in with what they wrote before: one
 * person has one opinion of a product, and changing your mind replaces it
 * rather than posting a second.
 */
import * as React from 'react';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PenLine, Trash2 } from 'lucide-react';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RatingInput } from './rating-input';
import {
  deleteReviewAction,
  submitReviewAction,
  type ReviewFormState,
} from '@/features/shop-reviews/actions';
import { BODY_MAX, BODY_MIN, TITLE_MAX } from '@/lib/storefront/reviews';
import type { OwnReview } from '@/lib/storefront/reviews/read';

export function ReviewForm({
  productId,
  productName,
  own,
}: {
  productId: string;
  productName: string;
  own: OwnReview | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(submitReviewAction, null);
  const [removeState, remove, removing] = useActionState<ReviewFormState, FormData>(
    deleteReviewAction,
    null,
  );

  /* The product page renders the reviews, so a saved review only appears
   * once the server has re-rendered it. */
  const saved = state?.message;
  const removed = removeState?.message;
  React.useEffect(() => {
    if (saved || removed) {
      setOpen(false);
      router.refresh();
    }
  }, [saved, removed, router]);

  if (!open) {
    return (
      <div className="rounded-2xl border bg-secondary/40 p-4 sm:p-5">
        {(saved || removed) && (
          <p role="status" className="mb-3 text-sm text-success">
            {saved ?? removed}
          </p>
        )}

        <p className="text-sm font-semibold">
          {own ? 'Your review of this product' : `You bought ${productName}`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {own
            ? 'You can change what you wrote, or take it down.'
            : 'Tell other shoppers how it worked out — what it’s like, and whether you’d buy it again.'}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <PenLine aria-hidden className="size-4" />
            {own ? 'Edit your review' : 'Write a review'}
          </button>

          {own && (
            <form action={remove}>
              <input type="hidden" name="productId" value={productId} />
              <button
                type="submit"
                disabled={removing}
                className="inline-flex h-10 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors hover:bg-secondary disabled:opacity-60"
              >
                {removing ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Trash2 aria-hidden className="size-4" />}
                Remove
              </button>
            </form>
          )}
        </div>

        {removeState?.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {removeState.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      action={action}
      noValidate
      className="space-y-4 rounded-2xl border bg-secondary/40 p-4 sm:p-5"
    >
      <input type="hidden" name="productId" value={productId} />

      <div>
        <h3 className="text-sm font-semibold">
          {own ? 'Edit your review' : `Review ${productName}`}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Your review shows your first name and last initial, with a verified purchase badge.
        </p>
      </div>

      {state?.error && !state.fieldErrors && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Field>
        {/* The group labels itself (`aria-label` on the radiogroup), so this
          * is a heading for sighted readers rather than a second label. */}
        <span className="text-[0.8125rem] font-semibold" aria-hidden>
          Your rating
        </span>
        <RatingInput
          defaultValue={Number(state?.values?.rating) || own?.rating || 0}
          error={state?.fieldErrors?.rating}
          describedBy={state?.fieldErrors?.rating ? 'review-rating-error' : undefined}
        />
        {state?.fieldErrors?.rating && (
          <FieldError id="review-rating-error">{state.fieldErrors.rating}</FieldError>
        )}
      </Field>

      <Field>
        <Label htmlFor="review-title" className="text-[0.8125rem] font-semibold">
          Headline
        </Label>
        <Input
          id="review-title"
          name="title"
          maxLength={TITLE_MAX}
          defaultValue={state?.values?.title ?? own?.title ?? ''}
          placeholder="Sum it up in a few words"
          aria-invalid={state?.fieldErrors?.title ? true : undefined}
          aria-describedby={state?.fieldErrors?.title ? 'review-title-error' : undefined}
          className="h-12 rounded-xl px-4 text-base"
          required
        />
        {state?.fieldErrors?.title && (
          <FieldError id="review-title-error">{state.fieldErrors.title}</FieldError>
        )}
      </Field>

      <Field>
        <Label htmlFor="review-body" className="text-[0.8125rem] font-semibold">
          Your review
        </Label>
        <Textarea
          id="review-body"
          name="body"
          rows={5}
          maxLength={BODY_MAX}
          defaultValue={state?.values?.body ?? own?.body ?? ''}
          placeholder="How does it look, feel and hold up? What would you tell a friend who’s thinking about it?"
          aria-invalid={state?.fieldErrors?.body ? true : undefined}
          aria-describedby={state?.fieldErrors?.body ? 'review-body-error' : 'review-body-hint'}
          className="rounded-xl px-4 py-3 text-base"
          required
        />
        {state?.fieldErrors?.body ? (
          <FieldError id="review-body-error">{state.fieldErrors.body}</FieldError>
        ) : (
          <FieldDescription id="review-body-hint">
            At least {BODY_MIN} characters. Please leave out personal details and anything you
            wouldn’t say to someone’s face.
          </FieldDescription>
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:flex-none"
        >
          {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {pending ? 'Posting…' : own ? 'Update review' : 'Post review'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-12 items-center justify-center rounded-full border px-6 text-sm font-semibold transition-colors hover:bg-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
