import { describe, expect, it } from 'vitest';
import { startOfTodayInLagos } from './day';

/*
 * "Today" is the merchant's day, not the server's. These pin the boundary so
 * a deploy to another region can't quietly move it.
 */
describe('startOfTodayInLagos', () => {
  const lagos = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(d);

  it('is local midnight, whatever the hour in UTC', () => {
    expect(lagos(startOfTodayInLagos(new Date('2026-09-22T12:00:00Z')))).toBe('22/09/2026, 00:00');
    expect(lagos(startOfTodayInLagos(new Date('2026-09-22T00:30:00Z')))).toBe('22/09/2026, 00:00');
  });

  it('rolls over at 23:00 UTC, an hour before the server would', () => {
    expect(lagos(startOfTodayInLagos(new Date('2026-09-22T22:59:00Z')))).toBe('22/09/2026, 00:00');
    expect(lagos(startOfTodayInLagos(new Date('2026-09-22T23:30:00Z')))).toBe('23/09/2026, 00:00');
  });
});
