/*
 * Questions & answers.
 *
 * Server component, and a `<details>` element per question — native
 * disclosure gets keyboard support, screen-reader semantics and open-by-URL
 * for free, and costs no JavaScript.
 *
 * Every answer is attributed (`ProductAnswer.source`). That field is the
 * point of this section: an assistant answering from the catalogue, the
 * reviews and the store's policies must still leave a shopper able to tell
 * whether they are reading the merchant, another customer, or a machine
 * summarising both.
 *
 * Phase 9 supplies the other half through `ask` — the assistant launcher.
 * There is still no question-submission form (that needs an account and a
 * merchant inbox), but a shopper with a question no longer has to leave the
 * page: the assistant answers from this product's own specs, variants,
 * reviews and the store's policies, and says plainly when the listing cannot
 * answer.
 */
import type * as React from 'react';
import { MessagesSquare, Sparkles } from 'lucide-react';
import { relativeTime } from '@/lib/storefront/format';
import type { ProductQuestion } from '@/lib/storefront/types';

const SOURCE_LABEL: Record<string, string> = {
  merchant: 'Store team',
  customer: 'Customer',
  assistant: 'Store assistant',
};

export function ProductQuestions({
  questions,
  productName,
  ask,
}: {
  questions: ProductQuestion[];
  productName: string;
  /** the assistant launcher — the only client island in this section */
  ask?: React.ReactNode;
}) {
  /* With neither existing questions nor a way to ask, there is nothing to
   * show — an empty heading is worse than no section. */
  if (!questions.length && !ask) return null;

  return (
    <section id="questions" aria-labelledby="questions-heading" className="scroll-mt-24">
      <h2 id="questions-heading" className="flex items-start gap-2 font-display text-xl sm:text-2xl">
        <MessagesSquare aria-hidden className="mt-1 size-5 shrink-0 text-teal" />
        Questions about {productName}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {questions.length > 0
          ? `Answered by the store team. ${questions.length} ${
              questions.length === 1 ? 'question' : 'questions'
            } so far.`
          : 'No questions on this product yet.'}
      </p>

      {ask && <div className="mt-4">{ask}</div>}

      {questions.length > 0 && (
        <ul className="mt-6 divide-y rounded-2xl border">
          {questions.map((question) => (
            <li key={question.id}>
              <details className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-start gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
                    Q
                  </span>
                  <span className="min-w-0 flex-1">{question.body}</span>
                  <span
                    aria-hidden
                    className="mt-1 shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>

                <div className="mt-3 space-y-3 pl-6">
                  {question.answers.map((answer) => (
                    <div key={answer.id}>
                      <p className="text-sm leading-relaxed text-muted-foreground">{answer.body}</p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {answer.source === 'assistant' && (
                          <Sparkles aria-hidden className="size-3 text-teal" />
                        )}
                        <span className="font-medium text-foreground">
                          {SOURCE_LABEL[answer.source] ?? answer.author}
                        </span>
                        <span aria-hidden>·</span>
                        <time dateTime={answer.createdAt}>{relativeTime(answer.createdAt)}</time>
                      </p>
                    </div>
                  ))}

                  <p className="text-xs text-muted-foreground">
                    Asked by {question.author} {relativeTime(question.createdAt)}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
