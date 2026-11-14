/*
 * lib/reports/ageing.ts
 *
 * How late money owed is (ROADMAP 21.8): not due yet, 1–30, 31–60, or over
 * 60 days past its due date. Pure. Something with no due date is counted as
 * not due — nobody said when.
 */
export type AgeBucket = 'notDue' | 'days1to30' | 'days31to60' | 'over60';

export type AgeFigures = Record<AgeBucket, number>;

export const AGE_BUCKETS: { key: AgeBucket; label: string }[] = [
  { key: 'notDue', label: 'Not due yet' },
  { key: 'days1to30', label: '1–30 days late' },
  { key: 'days31to60', label: '31–60 days late' },
  { key: 'over60', label: 'Over 60 days late' },
];

export const emptyAges = (): AgeFigures => ({ notDue: 0, days1to30: 0, days31to60: 0, over60: 0 });

export function ageBucket(dueAt: Date | null, now: Date): AgeBucket {
  if (!dueAt || dueAt >= now) return 'notDue';
  const days = Math.ceil((now.getTime() - dueAt.getTime()) / 86_400_000);
  if (days <= 30) return 'days1to30';
  if (days <= 60) return 'days31to60';
  return 'over60';
}
