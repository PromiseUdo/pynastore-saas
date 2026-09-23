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
 * objection under a product helps nobody. A store with no answered question
 * yet shows the form and says so.
 *
 * Two ways to ask, side by side: the assistant (`ask`), which answers
 * straight away from this product's own listing, reviews and the store's
 * policies, and the form, which reaches a human and whose answer lands on
 * this page for the next shopper. A guest is invited to sign in for the
 * second — asking needs an account so the merchant knows who they are
 * answering.
 */
import type * as React from 'react';
import Link from 'next/link';
import { MessagesSquare, Sparkles } from 'lucide-react';
import { relativeTime } from '@/lib/storefront/format';
import { QuestionForm } from './question-form';
import type { PendingQuestion } from '@/lib/storefront/questions/read';
import type { Product, ProductQuestion } from '@/lib/storefront/types';

const SOURCE_LABEL: Record<string, string> = {
  merchant: 'Store team',
  customer: 'Customer',
  assistant: 'Store assistant',
};

export interface QuestionViewer {
  /** the viewer's own questions the store hasn't answered yet */
  pending: PendingQuestion[];
  /** false for a guest — they're invited to sign in rather than shown a form */
  signedIn: boolean;
}

export function ProductQuestions({
  product,
  questions,
  viewer,
  ask,
}: {
  product: Product;
  questions: ProductQuestion[];
  viewer: QuestionViewer;
  /** the assistant launcher, offered beside the form */
  ask?: React.ReactNode;
}) {
  const productName = product.name;

  return (
    <section id="questions" aria-labelledby="questions-heading" className="scroll-mt-24">
      <h2 id="questions-heading" className="flex items-start gap-2 font-display text-xl sm:text-2xl">
        <MessagesSquare aria-hidden className="mt-1 size-5 shrink-0 text-teal" />
        Questions about {productName}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {questions.length > 0
          ? `Asked by customers, answered by the store team. ${questions.length} ${
              questions.length === 1 ? 'question' : 'questions'
            } so far.`
          : 'No questions answered on this product yet — yours would be the first.'}
      </p>

      <div className="mt-4 max-w-xl space-y-3">
        {viewer.signedIn ? (
          <QuestionForm productId={product.id} productName={productName} pending={viewer.pending} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Want to ask the store team something?{' '}
            <Link
              href={`/account/sign-in?next=${encodeURIComponent(`/products/${product.slug}`)}`}
              className="font-semibold text-foreground underline underline-offset-2"
            >
              Sign in
            </Link>{' '}
            to ask — they answer here, on this page.
          </p>
        )}
        {ask}
      </div>

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
