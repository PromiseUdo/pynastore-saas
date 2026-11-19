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
 * WHAT IS ON THIS PAGE was asked by a customer of this store and answered by
 * the merchant (lib/storefront/questions/). Nothing here is generated, and a
 * question the merchant hasn't answered is not shown — an unanswered
 * objection under a product helps nobody.
 *
 * There is no "Ask a question" form any more (removed 2026-11-19). It came
 * before Messages, and a shopper now has two better ways to ask, both in
 * `ask`: the shop's AI, which answers at once from the product's listing,
 * reviews and the store's policies, and a private message to the store team
 * (ROADMAP 17.3). Questions already answered stay here — they are the
 * merchant's own words and still help the next shopper — and anything still
 * waiting can be answered from Customers → Questions as before.
 *
 * With no answered questions, the section is just the offer to ask, and with
 * neither the AI nor Messages on the shop's plan it isn't shown at all.
 */
import type * as React from 'react';
import { MessagesSquare, Sparkles } from 'lucide-react';
import { relativeTime } from '@/lib/storefront/format';
import { cn } from '@/lib/utils';
import type { Product, ProductQuestion } from '@/lib/storefront/types';

const SOURCE_LABEL: Record<string, string> = {
  merchant: 'Store team',
  customer: 'Customer',
  assistant: 'Store assistant',
};

export function ProductQuestions({
  product,
  questions,
  ask,
}: {
  product: Product;
  questions: ProductQuestion[];
  /** the ways to ask now: the shop's AI and, when the shop takes them, a message */
  ask?: React.ReactNode;
}) {
  const productName = product.name;

  return (
    <section
      id="questions"
      aria-labelledby="questions-heading"
      className="scroll-mt-24"
    >
      <h2 id="questions-heading" className="flex items-start gap-2 font-display text-xl sm:text-2xl">
        <MessagesSquare aria-hidden className="mt-1 size-5 shrink-0 text-teal" />
        {questions.length > 0 ? `Questions about ${productName}` : `Have a question about ${productName}?`}
      </h2>
      {questions.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          Asked by customers, answered by the store team. {questions.length}{' '}
          {questions.length === 1 ? 'question' : 'questions'} so far.
        </p>
      )}

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

      {/* Hidden when neither way to ask is on the shop's plan (both render nothing). */}
      <div className={cn('has-[[data-ask]:empty]:hidden', questions.length > 0 ? 'mt-6' : 'mt-4')}>
        {questions.length > 0 && <p className="mb-3 text-sm font-semibold">Still have a question?</p>}
        <div data-ask className="flex flex-wrap items-center gap-3">
          {ask}
        </div>
      </div>
    </section>
  );
}
