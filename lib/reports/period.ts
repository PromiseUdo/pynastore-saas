/*
 * lib/reports/period.ts
 *
 * Which stretch of time a report covers (ROADMAP 14.6) — pure and
 * client-safe, so the page, the toolbar and the queries agree on it.
 *
 * Days are Lagos days. Every date on screen is formatted in Africa/Lagos
 * (lib/format.ts), so "today" in a report must be the same day a shop owner
 * sees on their receipts; a UTC day would put a sale at 00:30 on the 2nd
 * into the 1st. Lagos keeps UTC+1 all year (no daylight saving), so a fixed
 * offset is exact.
 *
 * Every range is [from, to): `to` is exclusive, the start of the day after
 * the last day shown.
 */

const DAY_MS = 86_400_000;
const LAGOS_OFFSET_MS = 3_600_000;

export const REPORT_PRESETS = ['7d', '30d', '90d', '12m'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const PRESET_LABEL: Record<ReportPreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
};

const PRESET_DAYS: Record<ReportPreset, number> = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };

export const DEFAULT_PRESET: ReportPreset = '30d';

/** The longest custom range, so a typo can't ask for a decade of orders. */
export const MAX_RANGE_DAYS = 366;

/** Up to this many days a report shows each day; longer, each month. */
export const DAILY_UP_TO_DAYS = 62;

export type BucketUnit = 'day' | 'month';

export interface ReportPeriod {
  /** the preset, or 'custom' for chosen dates */
  key: ReportPreset | 'custom';
  from: Date;
  /** exclusive */
  to: Date;
  /** first and last day shown, YYYY-MM-DD (Lagos) */
  firstDay: string;
  lastDay: string;
  days: number;
  unit: BucketUnit;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Lagos calendar day a moment falls on, as YYYY-MM-DD. */
export function lagosDay(date: Date): string {
  return new Date(date.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Lagos month a moment falls in, as YYYY-MM. */
export function lagosMonth(date: Date): string {
  return lagosDay(date).slice(0, 7);
}

/** Midnight in Lagos at the start of a YYYY-MM-DD day, or null if it isn't one. */
export function startOfLagosDay(day: string): Date | null {
  const m = ISO_DAY.exec(day);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const date = new Date(utc - LAGOS_OFFSET_MS);
  // Reject 2026-02-31 and the like, which Date.UTC would quietly roll over.
  return lagosDay(date) === day ? date : null;
}

function addDays(day: string, n: number): string {
  return lagosDay(new Date(startOfLagosDay(day)!.getTime() + n * DAY_MS));
}

function build(key: ReportPeriod['key'], firstDay: string, lastDay: string): ReportPeriod {
  const from = startOfLagosDay(firstDay)!;
  const to = startOfLagosDay(addDays(lastDay, 1))!;
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  return { key, from, to, firstDay, lastDay, days, unit: days <= DAILY_UP_TO_DAYS ? 'day' : 'month' };
}

export function isReportPreset(value: unknown): value is ReportPreset {
  return typeof value === 'string' && (REPORT_PRESETS as readonly string[]).includes(value);
}

/**
 * The period a report's URL asks for. Chosen dates (`from` and `to`, both
 * YYYY-MM-DD and both included) win over a preset when both are valid; they
 * are put in order if typed backwards, can't run past today, and are capped
 * at MAX_RANGE_DAYS. Anything unreadable falls back to the default preset —
 * a bad link shows a report, not an error.
 */
export function resolvePeriod(
  input: { range?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date(),
): ReportPeriod {
  const today = lagosDay(now);

  if (input.from && input.to && startOfLagosDay(input.from) && startOfLagosDay(input.to)) {
    let first = input.from <= input.to ? input.from : input.to;
    let last = input.from <= input.to ? input.to : input.from;
    if (last > today) last = today;
    if (first > last) first = last;
    const earliest = addDays(last, -(MAX_RANGE_DAYS - 1));
    if (first < earliest) first = earliest;
    return build('custom', first, last);
  }

  const preset = isReportPreset(input.range) ? input.range : DEFAULT_PRESET;
  return build(preset, addDays(today, -(PRESET_DAYS[preset] - 1)), today);
}

/** The same number of days immediately before, for "compared with before". */
export function previousPeriod(period: ReportPeriod): { from: Date; to: Date } {
  const span = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - span), to: period.from };
}

/**
 * Every bucket the period covers, in order — including the empty ones, so a
 * day with no sales shows as a gap rather than vanishing from the chart.
 */
export function bucketKeys(period: ReportPeriod): string[] {
  const keys: string[] = [];
  if (period.unit === 'day') {
    for (let day = period.firstDay; day <= period.lastDay; day = addDays(day, 1)) keys.push(day);
    return keys;
  }
  let [y, m] = period.firstDay.slice(0, 7).split('-').map(Number);
  const last = period.lastDay.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    keys.push(key);
    if (key >= last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/** The query string for a period, as the report links carry it. */
export function periodSearch(period: Pick<ReportPeriod, 'key' | 'firstDay' | 'lastDay'>): Record<string, string> {
  if (period.key === 'custom') return { from: period.firstDay, to: period.lastDay };
  if (period.key === DEFAULT_PRESET) return {};
  return { range: period.key };
}

/**
 * A change between two figures as a whole-number percentage, or null when
 * there was nothing before to compare with (growth from zero has no size).
 */
export function changePct(current: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((current - before) / before) * 100);
}

/**
 * How a bucket is named on screen: "3 Nov" / "3 Nov 2026" for a day,
 * "Nov" / "November 2026" for a month. Formatted in Lagos, like every date.
 */
export function bucketLabel(key: string, unit: BucketUnit, style: 'short' | 'long' = 'long'): string {
  const start = startOfLagosDay(unit === 'day' ? key : `${key}-01`);
  if (!start) return key;
  const options: Intl.DateTimeFormatOptions =
    unit === 'day'
      ? style === 'short'
        ? { day: 'numeric', month: 'short' }
        : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
      : style === 'short'
        ? { month: 'short' }
        : { month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Africa/Lagos' }).format(start);
}
