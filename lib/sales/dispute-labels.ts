/*
 * lib/sales/dispute-labels.ts
 *
 * How a chargeback reads to a shop owner (ROADMAP 10.5). Paystack's own words
 * for a dispute's status are system terms ("awaiting-bank-feedback"); these are
 * the plain ones (AGENTS §6). Client-safe.
 */

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  'awaiting-merchant-feedback': 'Needs a response',
  'awaiting-bank-feedback': 'With the customer’s bank',
  pending: 'Under review',
  resolved: 'Settled',
};

export const DISPUTE_STATUS_VARIANT: Record<string, 'overdue' | 'pending' | 'processing' | 'completed'> = {
  'awaiting-merchant-feedback': 'overdue',
  'awaiting-bank-feedback': 'pending',
  pending: 'processing',
  resolved: 'completed',
};

export function disputeLabel(status: string): string {
  return DISPUTE_STATUS_LABEL[status] ?? 'Under review';
}

/** What a settled dispute came to, in a sentence. */
export function disputeOutcome(resolution: string | null): string {
  if (resolution === 'declined') return 'Decided in your favour — the payment stands.';
  if (resolution === 'merchant-accepted') return 'Accepted — the customer’s bank takes the payment back.';
  return 'Settled by Paystack.';
}
