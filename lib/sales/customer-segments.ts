/*
 * lib/sales/customer-segments.ts
 *
 * The customer segments, and the one number that defines "gone quiet".
 *
 * A plain module because both the server query and the screen need these,
 * and a `'use server'` file may only export async functions — the same trap
 * `lib/currencies.ts` exists for.
 */

/** A customer counts as gone quiet after this long without buying. */
export const INACTIVE_AFTER_DAYS = 90;

export const CUSTOMER_SEGMENTS = [
  { key: 'all', label: 'Everyone', hint: null },
  { key: 'repeat', label: 'Repeat', hint: 'Customers who have placed two or more orders.' },
  {
    key: 'inactive',
    label: 'Gone quiet',
    hint: `Customers who have bought before, but not in the last ${INACTIVE_AFTER_DAYS} days.`,
  },
  { key: 'new', label: 'New this month', hint: 'Customers added since the start of this month.' },
  {
    key: 'has-returns',
    label: 'Has returns',
    hint: 'Customers who have asked to send something back at least once.',
  },
  {
    key: 'never-ordered',
    label: 'Never ordered',
    hint: 'People on your list who have never placed an order.',
  },
  {
    key: 'consented',
    label: 'Agreed to marketing',
    hint: 'Customers who told you they’re happy to hear from you.',
  },
] as const;

export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number]['key'];

export function isCustomerSegment(value: string | undefined): value is CustomerSegment {
  return Boolean(value) && CUSTOMER_SEGMENTS.some((s) => s.key === value);
}

export const CUSTOMER_SORTS = [
  { key: 'spend', label: 'Most spent' },
  { key: 'orders', label: 'Most orders' },
  { key: 'recent', label: 'Bought most recently' },
  { key: 'name', label: 'Name (A–Z)' },
] as const;

export type CustomerSort = (typeof CUSTOMER_SORTS)[number]['key'];

export function isCustomerSort(value: string | undefined): value is CustomerSort {
  return Boolean(value) && CUSTOMER_SORTS.some((s) => s.key === value);
}
