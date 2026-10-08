/*
 * lib/data-rights/policy.ts
 *
 * The platform's data-retention rules, in one place (ROADMAP 13.8). Decided
 * 2026-10-01; the numbers await counsel's confirmation with the rest of the
 * legal wording (10.10). docs/DATA-RIGHTS.md explains them in plain words,
 * and the privacy page restates them — change them here and there together.
 *
 *  - Business records — orders, invoices, payments, refunds and returns — are
 *    kept for FINANCIAL_RETENTION_YEARS, the usual Nigerian requirement for
 *    business and tax records. After that, nothing in them may identify a
 *    person.
 *  - A closed workspace can be restored by staff for CLOSURE_GRACE_DAYS.
 *    After that its personal data and store content are deleted; its
 *    business records follow when the retention period ends, and then the
 *    whole workspace is erased.
 *  - A guest's chat with a store (ROADMAP 17.5) is removed once nobody has
 *    written in it for GUEST_CHAT_RETENTION_MONTHS. A guest has no account
 *    to delete it from, so this is how it ends. A signed-in shopper's chat
 *    lasts as long as their account and goes when they delete it.
 */

export const FINANCIAL_RETENTION_YEARS = 6;
export const CLOSURE_GRACE_DAYS = 30;
export const GUEST_CHAT_RETENTION_MONTHS = 12;

const DAY = 86_400_000;

function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

/** A guest conversation last written in on or before this moment is due for removal at `now`. */
export function guestChatCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - GUEST_CHAT_RETENTION_MONTHS);
  return cutoff;
}

/** Records made on or before this moment are past the retention period at `now`. */
export function retentionCutoff(now: Date): Date {
  return addYears(now, -FINANCIAL_RETENTION_YEARS);
}

/** Until when staff can restore a workspace closed at `closedAt`. */
export function restorableUntil(closedAt: Date): Date {
  return new Date(closedAt.getTime() + CLOSURE_GRACE_DAYS * DAY);
}

/** When a workspace closed at `closedAt` is erased completely. */
export function erasedAt(closedAt: Date): Date {
  return addYears(closedAt, FINANCIAL_RETENTION_YEARS);
}

export type ClosureStage = 'restorable' | 'records-only' | 'due-for-erasure';

/** Where a closed workspace is in its life after closing. */
export function closureStage(closedAt: Date, now: Date): ClosureStage {
  if (now < restorableUntil(closedAt)) return 'restorable';
  if (now < erasedAt(closedAt)) return 'records-only';
  return 'due-for-erasure';
}
