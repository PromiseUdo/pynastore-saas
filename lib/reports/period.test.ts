import { describe, expect, it } from 'vitest';
import {
  bucketKeys,
  bucketLabel,
  changePct,
  lagosDay,
  periodSearch,
  previousPeriod,
  resolvePeriod,
  startOfLagosDay,
} from './period';

// 22:30 UTC on 6 Nov is already 7 Nov in Lagos.
const NOW = new Date('2026-11-06T23:30:00Z');

describe('Lagos days', () => {
  it('puts a moment on the Lagos calendar, not the UTC one', () => {
    expect(lagosDay(new Date('2026-11-06T22:59:59Z'))).toBe('2026-11-06');
    expect(lagosDay(new Date('2026-11-06T23:00:00Z'))).toBe('2026-11-07');
  });

  it('starts a day at midnight Lagos time and refuses days that do not exist', () => {
    expect(startOfLagosDay('2026-11-07')?.toISOString()).toBe('2026-11-06T23:00:00.000Z');
    expect(startOfLagosDay('2026-02-31')).toBeNull();
    expect(startOfLagosDay('7 Nov')).toBeNull();
  });
});

describe('resolvePeriod', () => {
  it('defaults to the last 30 days, today included', () => {
    const p = resolvePeriod({}, NOW);
    expect(p.key).toBe('30d');
    expect(p.lastDay).toBe('2026-11-07');
    expect(p.firstDay).toBe('2026-10-09');
    expect(p.days).toBe(30);
    expect(p.unit).toBe('day');
    expect(p.to.toISOString()).toBe('2026-11-07T23:00:00.000Z');
  });

  it('reads presets, and falls back on anything it cannot read', () => {
    expect(resolvePeriod({ range: '7d' }, NOW).firstDay).toBe('2026-11-01');
    const year = resolvePeriod({ range: '12m' }, NOW);
    expect(year.days).toBe(365);
    expect(year.unit).toBe('month');
    expect(resolvePeriod({ range: 'forever' }, NOW).key).toBe('30d');
    expect(resolvePeriod({ from: 'yesterday', to: '2026-11-01' }, NOW).key).toBe('30d');
  });

  it('takes chosen dates, in either order, never past today, and caps the span', () => {
    const p = resolvePeriod({ from: '2026-10-31', to: '2026-10-01' }, NOW);
    expect(p.key).toBe('custom');
    expect([p.firstDay, p.lastDay]).toEqual(['2026-10-01', '2026-10-31']);
    expect(p.days).toBe(31);

    expect(resolvePeriod({ from: '2026-11-01', to: '2027-01-01' }, NOW).lastDay).toBe('2026-11-07');
    const long = resolvePeriod({ from: '2020-01-01', to: '2026-11-07' }, NOW);
    expect(long.days).toBe(366);
  });

  it('compares with the same number of days just before', () => {
    const p = resolvePeriod({ range: '7d' }, NOW);
    const before = previousPeriod(p);
    expect(before.to).toEqual(p.from);
    expect(before.to.getTime() - before.from.getTime()).toBe(7 * 86_400_000);
  });
});

describe('buckets', () => {
  it('lists every day, empty ones included', () => {
    const keys = bucketKeys(resolvePeriod({ from: '2026-10-30', to: '2026-11-02' }, NOW));
    expect(keys).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('lists months for a long period, across a new year', () => {
    const keys = bucketKeys(resolvePeriod({ from: '2025-11-15', to: '2026-02-03' }, NOW));
    expect(keys).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('names buckets in words', () => {
    expect(bucketLabel('2026-11-07', 'day', 'short')).toBe('7 Nov');
    expect(bucketLabel('2026-11', 'month')).toBe('November 2026');
  });
});

describe('links and comparisons', () => {
  it('keeps the default out of the URL', () => {
    expect(periodSearch(resolvePeriod({}, NOW))).toEqual({});
    expect(periodSearch(resolvePeriod({ range: '90d' }, NOW))).toEqual({ range: '90d' });
    expect(periodSearch(resolvePeriod({ from: '2026-10-01', to: '2026-10-31' }, NOW))).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('gives no percentage for growth from nothing', () => {
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(50, 100)).toBe(-50);
    expect(changePct(100, 0)).toBeNull();
  });
});
