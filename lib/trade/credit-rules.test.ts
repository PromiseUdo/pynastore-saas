import { describe, expect, it } from 'vitest';
import { accountAvailability, type AccountStanding } from './credit-rules';
import { dueDateFrom } from './credit';

const standing = (over: Partial<AccountStanding> = {}): AccountStanding => ({
  days: 14,
  dueDate: '2026-12-01T22:59:59.999Z',
  creditLimit: 10_000_000,
  owed: 0,
  overdue: 0,
  ...over,
});

describe('pay on account (ROADMAP 21.5)', () => {
  it('allows an order within what’s left of the limit, and with no limit at all', () => {
    expect(accountAvailability(standing({ owed: 4_000_000 }), 6_000_000)).toEqual({ ok: true });
    expect(accountAvailability(standing({ creditLimit: null, owed: 1e12 }), 1e12)).toEqual({ ok: true });
  });

  it('refuses past the limit, and says how much is left', () => {
    const over = accountAvailability(standing({ owed: 4_000_000 }), 6_000_001);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.reason).toContain('₦60,000');
    const full = accountAvailability(standing({ owed: 10_000_000 }), 1);
    expect(!full.ok && full.reason).toContain('used all your credit');
  });

  it('refuses anything while something is overdue, before the limit is even looked at', () => {
    const overdue = accountAvailability(standing({ overdue: 500_000, creditLimit: null }), 100);
    expect(!overdue.ok && overdue.reason).toContain('₦5,000 overdue');
  });

  it('is due at the end of the Lagos day, so "due by 14 Dec" means all of the 14th', () => {
    // 23:30 Lagos on 1 Dec is still the 1st there; 14 days on is the end of the 15th.
    const due = dueDateFrom(new Date('2026-12-01T22:30:00Z'), 14);
    expect(due.toISOString()).toBe('2026-12-15T22:59:59.999Z');
    // 00:30 Lagos on 2 Dec (23:30 UTC on the 1st) counts from the 2nd.
    expect(dueDateFrom(new Date('2026-12-01T23:30:00Z'), 14).toISOString()).toBe('2026-12-16T22:59:59.999Z');
  });
});
