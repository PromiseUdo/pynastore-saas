/*
 * lib/storefront/questions/rules.ts
 *
 * What a question may be, what an answer may be, and how the two become the
 * public shape the product page renders. No database and no request, so both
 * sides — the shopper's form and the merchant's inbox — are held to one set
 * of rules and one test file.
 *
 * Who may ask is NOT here, because it is a fact about the session rather
 * than about the words: a signed-in customer of this store may ask. That is
 * checked in ./write.ts against the session, never against the form.
 */
import { displayName } from '../reviews/rules';
import type { ProductQuestion } from '../types';

export const QUESTION_MIN = 10;
export const QUESTION_MAX = 500;
export const ANSWER_MIN = 2;
export const ANSWER_MAX = 2000;

/** How a store is named on its own answers. Never a staff member's name. */
export const STORE_AUTHOR = 'Store team';

export type QuestionValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Check a question a shopper typed.
 *
 * The floor exists because "?" is not a question anyone can answer, and the
 * ceiling because a box without one is a box someone pastes an order history
 * into. Both are counted after trimming.
 */
export function validateQuestion(body: string): QuestionValidation {
  const trimmed = body.trim();
  if (trimmed.length < QUESTION_MIN) {
    return { ok: false, message: `Ask in a few more words — at least ${QUESTION_MIN} characters.` };
  }
  if (trimmed.length > QUESTION_MAX) {
    return { ok: false, message: `Questions can be up to ${QUESTION_MAX} characters.` };
  }
  return { ok: true, value: trimmed };
}

/** Check a merchant's answer. It is published the moment it is saved. */
export function validateAnswer(body: string): QuestionValidation {
  const trimmed = body.trim();
  if (trimmed.length < ANSWER_MIN) {
    return { ok: false, message: 'Write an answer before publishing it' };
  }
  if (trimmed.length > ANSWER_MAX) {
    return { ok: false, message: `Keep the answer under ${ANSWER_MAX} characters` };
  }
  return { ok: true, value: trimmed };
}

/** The row as the storefront needs it, whatever read it came from. */
export interface QuestionRow {
  id: string;
  productId: string;
  body: string;
  createdAt: Date;
  answerBody: string | null;
  answeredAt: Date | null;
  customer: { name: string };
}

/**
 * A row → the public question.
 *
 * The asker is named as reviewers are: first name, last initial. The answer
 * becomes a one-item list because the storefront's shape allows several and
 * a store answers once — when an assistant drafts one, it arrives in this
 * same list with a different `source`, and the section needs no change.
 */
export function toPublicQuestion(row: QuestionRow): ProductQuestion {
  const answeredAt = row.answeredAt ?? row.createdAt;

  return {
    id: row.id,
    productId: row.productId,
    body: row.body,
    author: displayName(row.customer.name),
    createdAt: row.createdAt.toISOString(),
    helpful: 0,
    answers: row.answerBody
      ? [
          {
            id: `${row.id}_a`,
            body: row.answerBody,
            author: STORE_AUTHOR,
            source: 'merchant',
            createdAt: answeredAt.toISOString(),
          },
        ]
      : [],
  };
}
