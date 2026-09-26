/*
 * Delivery windows in the unit the merchant actually works in. Minutes are
 * the one stored figure; the unit only decides the words.
 */
import { describe, expect, it } from 'vitest';
import { eta, formatEta, formatEtaShort, formatEtaSpan, formatEtaWindow, formatReady, fromMinutes, toMinutes } from './eta';

describe('storing a window', () => {
  it('keeps minutes as the one figure, whatever unit it was typed in', () => {
    expect(toMinutes(45, 'MINUTES')).toBe(45);
    expect(toMinutes(2, 'HOURS')).toBe(120);
    expect(toMinutes(3, 'DAYS')).toBe(4320);
  });

  it('gives the merchant back the number they typed', () => {
    expect(fromMinutes(120, 'HOURS')).toBe(2);
    expect(fromMinutes(4320, 'DAYS')).toBe(3);
    expect(fromMinutes(45, 'MINUTES')).toBe(45);
  });
});

describe('wording a window', () => {
  it('says days as working days, and 0 as same day', () => {
    expect(formatEta(eta(2880, 5760, 'DAYS'))).toBe('2–4 working days');
    expect(formatEta(eta(1440, 1440, 'DAYS'))).toBe('Next working day');
    expect(formatEta(eta(0, 0, 'DAYS'))).toBe('Same day');
  });

  it('says hours and minutes in their own words — never "0 working days"', () => {
    expect(formatEta(eta(45, 45, 'MINUTES'))).toBe('Within 45 minutes');
    expect(formatEta(eta(30, 60, 'MINUTES'))).toBe('30–60 minutes');
    expect(formatEta(eta(120, 120, 'HOURS'))).toBe('Within 2 hours');
    expect(formatEta(eta(120, 180, 'HOURS'))).toBe('2–3 hours');
    expect(formatEta(eta(60, 60, 'HOURS'))).toBe('Within 1 hour');
  });

  it('words a pickup as readiness, not arrival', () => {
    expect(formatReady(eta(0, 0, 'DAYS'))).toBe('Ready to collect today');
    expect(formatReady(eta(1440, 1440, 'DAYS'))).toBe('Ready to collect in 1 working day');
    expect(formatReady(eta(30, 30, 'MINUTES'))).toBe('Ready to collect in 30 minutes');
  });

  it('shortens for admin tables', () => {
    expect(formatEtaShort(eta(45, 45, 'MINUTES'))).toBe('45 min');
    expect(formatEtaShort(eta(120, 180, 'HOURS'))).toBe('2–3 hrs');
    expect(formatEtaShort(eta(1440, 1440, 'DAYS'))).toBe('1 day');
  });
});

/* A zone can hold a 45-minute rider and a 2-day courier at once. */
describe('a span over options measured differently', () => {
  it('reads as one window when both sides share a unit', () => {
    expect(formatEtaSpan({ minutes: 1440, unit: 'DAYS' }, { minutes: 4320, unit: 'DAYS' })).toBe('1–3 working days');
  });

  it('keeps each side in its own unit when they differ', () => {
    expect(formatEtaSpan({ minutes: 45, unit: 'MINUTES' }, { minutes: 2880, unit: 'DAYS' })).toBe('45 minutes – 2 working days');
  });
});

describe('what an order says about when it lands', () => {
  const estimated = { from: '2026-09-25T09:30:00.000Z', to: '2026-09-25T10:15:00.000Z' };

  it('gives two dates for a window in working days', () => {
    expect(formatEtaWindow(eta(1440, 2880, 'DAYS'), { from: '2026-09-25T09:00:00.000Z', to: '2026-09-28T09:00:00.000Z' })).toMatch(
      /^Estimated .+ – .+$/,
    );
  });

  it('gives a time, not a date, for a window in minutes', () => {
    expect(formatEtaWindow(eta(45, 45, 'MINUTES'), estimated)).toMatch(/^Estimated within 45 minutes · by /);
  });
});
