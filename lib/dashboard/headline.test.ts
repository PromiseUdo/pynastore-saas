import { describe, expect, it } from 'vitest';
import { greeting, headline } from './headline';
import type { WeekFigures } from '@/features/dashboard/overview';

const week = (todaySales: number, todayOrders: number) =>
  ({ todaySales, todayOrders } as Pick<WeekFigures, 'todaySales' | 'todayOrders'> as WeekFigures);
// 09:00, 14:00 and 19:00 in Lagos (UTC+1).
const at = (lagosHour: number) => new Date(Date.UTC(2026, 10, 14, lagosHour - 1, 0));

describe('the home page greeting', () => {
  it('follows the clock in Lagos', () => {
    expect(greeting(at(9))).toBe('Good morning');
    expect(greeting(at(14))).toBe('Good afternoon');
    expect(greeting(at(19))).toBe('Good evening');
    expect(greeting(at(0))).toBe('Good morning');
  });

  it('says today in one sentence, by name when there is one', () => {
    expect(headline('Ada', week(15_000, 3), 'NGN', 'Ada Fabrics', at(9))).toBe('Good morning, Ada. Today so far: ₦15,000 from 3 orders.');
    expect(headline('Ada', week(5_000, 1), 'NGN', 'Ada Fabrics', at(14))).toBe('Good afternoon, Ada. Today so far: ₦5,000 from 1 order.');
    expect(headline(null, week(0, 0), 'NGN', 'Ada Fabrics', at(19))).toBe('Good evening. No orders yet today.');
  });

  it('keeps money out of it for a member who can’t see sales', () => {
    expect(headline('Bola', null, 'NGN', 'Ada Fabrics', at(9))).toBe('Good morning, Bola. Here’s what needs you at Ada Fabrics.');
  });
});
