import { describe, expect, it } from 'vitest';
import { enumLabel, formatDate, formatDateTime, formatMoney, formatMoneyRange, formatRelativeTime, formatTime } from './format';

describe('format', () => {
  it('formats naira', () => {
    expect(formatMoney(5000)).toBe('₦5,000');
    expect(formatMoney(5000.5)).toBe('₦5,000.50');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoneyRange(5000, 9000)).toBe('₦5,000 – ₦9,000');
    expect(formatMoneyRange(5000, 5000)).toBe('₦5,000');
  });
  it('formats dates and enums', () => {
    expect(formatDate('2026-05-14T10:00:00Z')).toBe('14 May 2026');
    expect(enumLabel('PARTIALLY_PAID')).toBe('Partially paid');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-14T12:00:00Z');

  it('reads as "just now" under a minute', () => {
    expect(formatRelativeTime(new Date('2026-05-14T11:59:30Z'), now)).toBe('just now');
  });

  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime(new Date('2026-05-14T11:30:00Z'), now)).toBe('30 minutes ago');
    expect(formatRelativeTime(new Date('2026-05-14T09:00:00Z'), now)).toBe('3 hours ago');
    expect(formatRelativeTime(new Date('2026-05-11T12:00:00Z'), now)).toBe('3 days ago');
  });

  it('falls back to a plain date once it stops being useful', () => {
    expect(formatRelativeTime(new Date('2026-01-14T12:00:00Z'), now)).toBe('14 Jan 2026');
  });

  it('shows a dash for nothing', () => {
    expect(formatRelativeTime(null, now)).toBe('—');
  });
});

describe('formatTime and formatDateTime', () => {
  it('shows the time of day in Lagos time, whatever the server’s zone', () => {
    // 13:41 UTC is 14:41 in Lagos (UTC+1, no daylight saving)
    expect(formatTime('2026-05-14T13:41:00Z')).toBe('2:41 pm');
    expect(formatDateTime('2026-05-14T13:41:00Z')).toBe('14 May 2026, 2:41 pm');
  });

  it('crosses midnight with Lagos, not UTC', () => {
    expect(formatDateTime('2026-05-14T23:30:00Z')).toBe('15 May 2026, 12:30 am');
  });

  it('shows a dash for nothing', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });
});
