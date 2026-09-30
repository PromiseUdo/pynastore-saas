/*
 * The plan rules of ROADMAP 12.1 — pure, no database: what state a workspace
 * is in, when its grace ends, what a lapsed workspace can still open, and how
 * a cycle is priced.
 */
import { describe, expect, it } from 'vitest';
import {
  accessEndedAt,
  daysUntil,
  isOpenWhileLapsed,
  resolveAccess,
  RENEWAL_TOLERANCE_DAYS,
  storefrontOpen,
  type SubscriptionFacts,
} from './access';
import { cyclePrice, periodEnd, planHasFeature, NO_PLAN } from './plans';
import { planLabel } from '@/components/layout/plan-notice';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-01T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * DAY);

const sub = (over: Partial<SubscriptionFacts>): SubscriptionFacts => ({
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodEnd: at(10),
  cancelAtPeriodEnd: false,
  lapsedAt: null,
  graceEndsAt: null,
  ...over,
});

describe('resolveAccess', () => {
  it('is none with no subscription — nothing locked', () => {
    expect(resolveAccess(null, now, 10)).toMatchObject({ state: 'none', toRecord: null });
  });

  it('is trial while the trial runs, then grace from the day it ended', () => {
    expect(resolveAccess(sub({ status: 'TRIALING', trialEndsAt: at(3) }), now, 10).state).toBe('trial');

    const ended = resolveAccess(sub({ status: 'TRIALING', trialEndsAt: at(-2) }), now, 10);
    expect(ended.state).toBe('grace');
    expect(ended.graceEndsAt).toEqual(at(8));
    expect(ended.toRecord).toEqual({ lapsedAt: at(-2), graceEndsAt: at(8) });
  });

  it('is lapsed once grace is over', () => {
    expect(resolveAccess(sub({ status: 'TRIALING', trialEndsAt: at(-11) }), now, 10).state).toBe('lapsed');
  });

  it('with 0 grace days, closes the moment access ends', () => {
    expect(resolveAccess(sub({ status: 'TRIALING', trialEndsAt: at(-0.01) }), now, 0).state).toBe('lapsed');
  });

  it('gives a renewing plan a few days for the renewal to arrive', () => {
    expect(resolveAccess(sub({ currentPeriodEnd: at(-(RENEWAL_TOLERANCE_DAYS - 1)) }), now, 10).state).toBe('active');
    const late = resolveAccess(sub({ currentPeriodEnd: at(-(RENEWAL_TOLERANCE_DAYS + 1)) }), now, 10);
    expect(late.state).toBe('grace');
    expect(late.toRecord?.lapsedAt).toEqual(at(-(RENEWAL_TOLERANCE_DAYS + 1)));
  });

  it('ends a cancelled plan at the end of its period, with no extra days', () => {
    expect(resolveAccess(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(1) }), now, 10).state).toBe('active');
    expect(accessEndedAt(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) }), now)).toEqual(at(-1));
    expect(accessEndedAt(sub({ status: 'CANCELED', currentPeriodEnd: at(-1) }), now)).toEqual(at(-1));
  });

  it('keeps a past-due plan open to the end of what was paid for', () => {
    expect(resolveAccess(sub({ status: 'PAST_DUE', currentPeriodEnd: at(2) }), now, 10).state).toBe('active');
    expect(resolveAccess(sub({ status: 'PAST_DUE', currentPeriodEnd: at(-2) }), now, 10).state).toBe('grace');
  });

  it('keeps a recorded deadline even if the grace setting changes', () => {
    const recorded = sub({ status: 'TRIALING', trialEndsAt: at(-2), lapsedAt: at(-2), graceEndsAt: at(8) });
    expect(resolveAccess(recorded, now, 0)).toMatchObject({ state: 'grace', graceEndsAt: at(8), toRecord: null });
    expect(resolveAccess(recorded, now, 30)).toMatchObject({ graceEndsAt: at(8) });
  });

  it('treats a workspace with no trial and no plan as closed', () => {
    expect(resolveAccess(sub({ status: 'INCOMPLETE', currentPeriodEnd: null, lapsedAt: now, graceEndsAt: now }), now, 10).state).toBe(
      'lapsed',
    );
  });
});

describe('what stays open', () => {
  it('sells in every state but lapsed', () => {
    expect(['trial', 'active', 'grace', 'none'].every((s) => storefrontOpen(s as never))).toBe(true);
    expect(storefrontOpen('lapsed')).toBe(false);
  });

  it('opens billing, plans and existing orders — not a new sale', () => {
    expect(isOpenWhileLapsed('/settings/billing')).toBe(true);
    expect(isOpenWhileLapsed('/upgrade')).toBe(true);
    expect(isOpenWhileLapsed('/sales/orders')).toBe(true);
    expect(isOpenWhileLapsed('/sales/orders/abc123')).toBe(true);
    expect(isOpenWhileLapsed('/sales/orders/new')).toBe(false);
    expect(isOpenWhileLapsed('/sales/ordersx')).toBe(false);
    expect(isOpenWhileLapsed('/inventory')).toBe(false);
    expect(isOpenWhileLapsed('/dashboard')).toBe(false);
  });

  it('counts days left, never negative', () => {
    expect(daysUntil(at(2.5), now)).toBe(3);
    expect(daysUntil(at(-1), now)).toBe(0);
  });
});

describe('prices and periods', () => {
  it('prices a cycle from the monthly price less its discount', () => {
    expect(cyclePrice(5000, 'MONTHLY', 0)).toBe(5000);
    expect(cyclePrice(5000, 'BIANNUAL', 10)).toBe(27000);
    expect(cyclePrice(5000, 'YEARLY', 17)).toBe(49800);
  });

  it('ends a period the same day, months later — or on the month’s last day', () => {
    expect(periodEnd('MONTHLY', new Date('2026-03-15T09:00:00Z'))).toEqual(new Date('2026-04-15T09:00:00Z'));
    expect(periodEnd('MONTHLY', new Date('2027-01-31T09:00:00Z'))).toEqual(new Date('2027-02-28T09:00:00Z'));
    expect(periodEnd('BIANNUAL', new Date('2026-08-31T09:00:00Z'))).toEqual(new Date('2027-02-28T09:00:00Z'));
    expect(periodEnd('YEARLY', new Date('2028-02-29T09:00:00Z'))).toEqual(new Date('2029-02-28T09:00:00Z'));
  });

  it('unlocks nothing without a plan', () => {
    expect(planHasFeature(NO_PLAN, 'inventory.module')).toBe(false);
  });

  it('names the plan for the sidebar', () => {
    expect(planLabel('trial', 'Pro')).toBe('Pro · Trial');
    expect(planLabel('active', 'Pro')).toBe('Pro');
    expect(planLabel('grace', 'Pro')).toBe('Plan ended');
    expect(planLabel('none', 'No plan')).toBe('No plan');
  });
});
