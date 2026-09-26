/*
 * lib/storefront/delivery/eta.ts
 *
 * How long delivery takes, and how we say it.
 *
 * Merchants don't all think in days. A supermarket delivers in 45 minutes, a
 * dispatch rider in 2–3 hours, a wholesaler in 3–5 working days. So a delivery
 * time is a number of MINUTES (the one canonical figure everything sorts,
 * compares and dates by) plus the unit the merchant entered it in, which is
 * only ever used to word it back: 45 minutes stays "45 minutes" and never
 * becomes "0 working days".
 *
 * Pure and client-safe — the admin settings page, checkout and the order
 * pages all read their wording from here, so no two screens can disagree.
 */

import { formatDate, formatTime } from '../format';

export const ETA_UNITS = ['MINUTES', 'HOURS', 'DAYS'] as const;
export type DeliveryEtaUnit = (typeof ETA_UNITS)[number];

/** How many minutes one of each unit is worth. */
export const MINUTES_PER_UNIT: Record<DeliveryEtaUnit, number> = {
  MINUTES: 1,
  HOURS: 60,
  DAYS: 60 * 24,
};

/** A delivery window. `minMinutes`/`maxMinutes` are the truth; `unit` is how to say it. */
export interface DeliveryEta {
  minMinutes: number;
  maxMinutes: number;
  unit: DeliveryEtaUnit;
}

export const ETA_UNIT_LABELS: Record<DeliveryEtaUnit, string> = {
  MINUTES: 'Minutes',
  HOURS: 'Hours',
  DAYS: 'Working days',
};

export function isEtaUnit(value: unknown): value is DeliveryEtaUnit {
  return typeof value === 'string' && (ETA_UNITS as readonly string[]).includes(value);
}

/** A figure the merchant typed, in its unit, as minutes. */
export function toMinutes(amount: number, unit: DeliveryEtaUnit): number {
  return Math.round(amount * MINUTES_PER_UNIT[unit]);
}

/** Minutes back in the merchant's unit, for an input box. */
export function fromMinutes(minutes: number, unit: DeliveryEtaUnit): number {
  return Math.round((minutes / MINUTES_PER_UNIT[unit]) * 100) / 100;
}

export function eta(minMinutes: number, maxMinutes: number, unit: DeliveryEtaUnit): DeliveryEta {
  return { minMinutes, maxMinutes, unit };
}

/** A same-day promise: nothing to wait past today for. */
export function isSameDay(value: DeliveryEta): boolean {
  return value.maxMinutes <= 0 || (value.unit !== 'DAYS' && value.maxMinutes < MINUTES_PER_UNIT.DAYS);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One side of a window on its own: "45 minutes", "2 hours", "3 working days". */
function amount(minutes: number, unit: DeliveryEtaUnit): string {
  const n = fromMinutes(minutes, unit);
  switch (unit) {
    case 'MINUTES':
      return plural(n, 'minute', 'minutes');
    case 'HOURS':
      return plural(n, 'hour', 'hours');
    case 'DAYS':
      return plural(n, 'working day', 'working days');
  }
}

/**
 * The window as a sentence a shopper reads: "Same day", "Within 45 minutes",
 * "2–3 hours", "Next working day", "3–5 working days".
 */
export function formatEta(value: DeliveryEta): string {
  const { minMinutes, maxMinutes, unit } = value;
  if (maxMinutes <= 0) return 'Same day';

  const min = fromMinutes(minMinutes, unit);
  const max = fromMinutes(maxMinutes, unit);

  if (unit === 'DAYS') {
    if (min === max) return max === 1 ? 'Next working day' : `${max} working days`;
    return `${min}–${max} working days`;
  }
  if (min === max || minMinutes <= 0) return `Within ${amount(maxMinutes, unit)}`;
  return `${min}–${amount(maxMinutes, unit)}`;
}

/** The same window for a pickup location: what's promised is readiness, not arrival. */
export function formatReady(value: DeliveryEta): string {
  if (value.maxMinutes <= 0) return 'Ready to collect today';
  const min = fromMinutes(value.minMinutes, value.unit);
  const max = fromMinutes(value.maxMinutes, value.unit);
  const window = min === max || value.minMinutes <= 0 ? amount(value.maxMinutes, value.unit) : `${min}–${amount(value.maxMinutes, value.unit)}`;
  return `Ready to collect in ${window}`;
}

/**
 * A window spanning options measured in different units — the fastest rate in
 * a zone may be "45 minutes" while the slowest is "2 working days". Same unit
 * on both sides reads as one window; otherwise each side keeps its own words.
 */
export function formatEtaSpan(
  low: { minutes: number; unit: DeliveryEtaUnit },
  high: { minutes: number; unit: DeliveryEtaUnit },
): string {
  if (low.unit === high.unit) return formatEta(eta(low.minutes, high.minutes, low.unit));
  if (high.minutes <= 0) return 'Same day';
  if (low.minutes <= 0) return `Same day – ${amount(high.minutes, high.unit)}`;
  return `${amount(low.minutes, low.unit)} – ${amount(high.minutes, high.unit)}`;
}

/** Short wording for admin tables: "Same day", "45 min", "2–3 hrs", "3–5 days". */
export function formatEtaShort(value: DeliveryEta): string {
  const { minMinutes, maxMinutes, unit } = value;
  if (maxMinutes <= 0) return 'Same day';
  const min = fromMinutes(minMinutes, unit);
  const max = fromMinutes(maxMinutes, unit);
  const noun = unit === 'MINUTES' ? 'min' : unit === 'HOURS' ? (max === 1 ? 'hr' : 'hrs') : max === 1 ? 'day' : 'days';
  return min === max ? `${max} ${noun}` : `${min}–${max} ${noun}`;
}

/**
 * What an order says about when it lands. A window in working days is two
 * dates; a window in minutes or hours is a time later today, and a date
 * either side of it would tell the shopper nothing.
 */
export function formatEtaWindow(
  value: DeliveryEta,
  estimated: { from: string; to: string },
  locale = 'en-NG',
): string {
  if (value.unit === 'DAYS') {
    return `Estimated ${formatDate(estimated.from, locale)} – ${formatDate(estimated.to, locale)}`;
  }
  const window = formatEta(value);
  return `Estimated ${window.charAt(0).toLowerCase()}${window.slice(1)} · by ${formatTime(estimated.to, locale)}`;
}
