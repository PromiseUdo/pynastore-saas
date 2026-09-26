// lib/format.ts
// The admin's single place for turning numbers and dates into text
// (AGENTS.md §6). Fixed locale so server and client render identically.

/** Organization has no currency column yet; every tenant trades in naira. */
export const DEFAULT_CURRENCY = 'NGN';

const LOCALE = 'en-NG';

export function formatMoney(amount: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** "₦5,000" or "₦5,000 – ₦9,000" */
export function formatMoneyRange(min: number | null, max: number | null, currency = DEFAULT_CURRENCY): string {
  if (min === null) return '—';
  if (max === null || max === min) return formatMoney(min, currency);
  return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
}

export function formatNumber(value: number | null | undefined, maxFractionDigits = 2): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** "14 May 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(
    new Date(value),
  );
}

/** "September 2026" — for a figure that covers a whole month. */
export function formatMonth(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(value));
}

/** Plain-language label for a SCREAMING_SNAKE enum value: PARTIALLY_PAID → "Partially paid". */
export function enumLabel(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * "just now", "2 hours ago", "3 days ago" — for activity and recently-placed
 * records (AGENTS §6). Anything older than a month reads as a plain date,
 * because "7 weeks ago" is harder to act on than "14 May 2026".
 *
 * `now` is injectable so this is testable and so a server render can pass the
 * same instant to every row.
 */
export function formatRelativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const then = new Date(value);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);

  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 0) return formatDate(then);
  if (seconds < 60) return 'just now';

  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return formatDate(then);
}
