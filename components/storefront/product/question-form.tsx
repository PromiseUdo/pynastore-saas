'use client';

/*
 * Asking the store a question about a product.
 *
 * Collapsed behind one button, like the review form, so the answered
 * questions stay the point of the section. It says plainly what happens
 * next: the store team answers, and the answer appears on this page for
 * everyone — because a shopper typing into a public page deserves to know
 * it is a public page.
 *
 * A guest gets no form. Asking needs an account, which is how the merchant
 * knows who they are answering and how the asker gets a name on the page.
 */
import * as React from 'react';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCirclePlus } from 'lucide-react';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { askQuestionAction, type QuestionFormState } from '@/features/shop-questions/actions';
import { QUESTION_MAX, QUESTION_MIN } from '@/lib/storefront/questions';
import type { PendingQuestion } from '@/lib/storefront/questions/read';
import { relativeTime } from '@/lib/storefront/format';

export function QuestionForm({
  productId,
  productName,
  pending: waiting,
}: {
  productId: string;
  productName: string;
  /** the shopper's own questions the store hasn't answered yet */
  pending: PendingQuestion[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, action, submitting] = useActionState<QuestionFormState, FormData>(
    askQuestionAction,
    null,
  );

  /* A new question isn't on the page — it's in the merchant's inbox — but
   * the "waiting for an answer" note below is, so re-render for it. */
  const sent = state?.message;
  React.useEffect(() => {
    if (sent) {
      setOpen(false);
      router.refresh();
    }
  }, [sent, router]);

  const yours = waiting.length > 0 && (
    <div className="mt-3 rounded-xl border border-dashed p-3">
      <p className="text-xs font-semibold">Waiting for an answer</p>
      <ul className="mt-2 space-y-2">
        {waiting.map((question) => (
          <li key={question.id} className="text-xs text-muted-foreground">
            “{question.body}” · asked {relativeTime(question.createdAt)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Only you can see these. They appear here for everyone once the store answers.
      </p>
    </div>
  );

  if (!open) {
    return (
      <div className="rounded-2xl border bg-secondary/40 p-4 sm:p-5">
        {sent && (
          <p role="status" className="mb-3 text-sm text-success">
            {sent}
          </p>
        )}

        <p className="text-sm font-semibold">Something you want to know?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask the store team about {productName}. Answers are published on this page.
        </p>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessageCirclePlus aria-hidden className="size-4" />
          Ask a question
        </button>

        {yours}
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-4 rounded-2xl border bg-secondary/40 p-4 sm:p-5">
      <input type="hidden" name="productId" value={productId} />

      <div>
        <h3 className="text-sm font-semibold">Ask about {productName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The store team answers in their own words. Your question and their answer are published
          here under your first name and last initial.
        </p>
      </div>

      {state?.error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}

      <Field>
        <Label htmlFor="question-body" className="text-[0.8125rem] font-semibold">
          Your question
        </Label>
        <Textarea
          id="question-body"
          name="body"
          rows={4}
          maxLength={QUESTION_MAX}
          defaultValue={state?.values?.body ?? ''}
          placeholder="e.g. Does this come with a charger in the box?"
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? 'question-body-error' : 'question-body-hint'}
          className="rounded-xl px-4 py-3 text-base"
          required
        />
        {state?.error ? (
          <FieldError id="question-body-error">{state.error}</FieldError>
        ) : (
          <FieldDescription id="question-body-hint">
            At least {QUESTION_MIN} characters. Please leave out your phone number, address and
            order details — this page is public.
          </FieldDescription>
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:flex-none"
        >
          {submitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {submitting ? 'Sending…' : 'Send question'}
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
