/*
 * The Q&A rules: what may be asked, what may be answered, and what a row
 * looks like once it reaches the product page.
 *
 * The database halves (./read.ts, ./write.ts) are covered by
 * tests/storefront-questions.test.ts, which runs them against real rows.
 */
import { describe, expect, it } from 'vitest';
import {
  ANSWER_MAX,
  QUESTION_MAX,
  QUESTION_MIN,
  STORE_AUTHOR,
  toPublicQuestion,
  validateAnswer,
  validateQuestion,
} from './rules';

describe('asking', () => {
  it('1. refuses a question too short to answer, and counts after trimming', () => {
    expect(validateQuestion('  ?  ').ok).toBe(false);
    expect(validateQuestion(' '.repeat(40)).ok).toBe(false);
    expect(validateQuestion('a'.repeat(QUESTION_MIN - 1)).ok).toBe(false);
  });

  it('2. accepts a real question and stores it trimmed', () => {
    const result = validateQuestion('  Does this come with a charger?  ');
    expect(result).toEqual({ ok: true, value: 'Does this come with a charger?' });
  });

  it('3. refuses an essay', () => {
    expect(validateQuestion('a'.repeat(QUESTION_MAX + 1)).ok).toBe(false);
    expect(validateQuestion('a'.repeat(QUESTION_MAX).padStart(QUESTION_MAX, 'a')).ok).toBe(true);
  });
});

describe('answering', () => {
  it('4. refuses an empty answer — saving one is publishing it', () => {
    expect(validateAnswer('   ').ok).toBe(false);
    expect(validateAnswer('a'.repeat(ANSWER_MAX + 1)).ok).toBe(false);
  });

  it('5. accepts a short one: "Yes." answers plenty of questions', () => {
    expect(validateAnswer(' Yes. ')).toEqual({ ok: true, value: 'Yes.' });
  });
});

describe('what a shopper sees', () => {
  const row = {
    id: 'q1',
    productId: 'p1',
    body: 'Does it ship to Enugu?',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    answerBody: 'Yes — 2 to 4 working days.',
    answeredAt: new Date('2026-09-02T10:00:00Z'),
    customer: { name: 'Adaeze Obi' },
  };

  it('6. names the asker as reviews do, and the store as one voice', () => {
    const question = toPublicQuestion(row);
    expect(question.author).toBe('Adaeze O.');
    expect(question.answers).toHaveLength(1);
    expect(question.answers[0]).toMatchObject({
      body: 'Yes — 2 to 4 working days.',
      author: STORE_AUTHOR,
      source: 'merchant',
      createdAt: '2026-09-02T10:00:00.000Z',
    });
  });

  it('7. carries no answer when there is none — nothing is invented for it', () => {
    expect(toPublicQuestion({ ...row, answerBody: null, answeredAt: null }).answers).toEqual([]);
  });
});
