import { describe, expect, it } from 'vitest';
import {
  bestPrice,
  campaignPhase,
  campaignPriceFor,
  isCampaignLive,
  type CampaignWindow,
} from './campaign-rules';

const at = (iso: string) => new Date(iso);

describe('campaignPhase', () => {
  const window = (over: Partial<CampaignWindow> = {}): CampaignWindow => ({
    status: 'SCHEDULED',
    startsAt: at('2026-12-01T00:00:00Z'),
    endsAt: at('2026-12-26T00:00:00Z'),
    ...over,
  });

  it('is scheduled before it opens and active inside its window', () => {
    expect(campaignPhase(window(), at('2026-11-30T23:59:00Z'))).toBe('SCHEDULED');
    expect(campaignPhase(window(), at('2026-12-01T00:00:00Z'))).toBe('ACTIVE');
    expect(campaignPhase(window(), at('2026-12-25T23:59:00Z'))).toBe('ACTIVE');
  });

  it('ends itself the moment the window closes, with nothing to flip', () => {
    expect(campaignPhase(window(), at('2026-12-26T00:00:00Z'))).toBe('ENDED');
    expect(isCampaignLive(window(), at('2026-12-26T00:00:01Z'))).toBe(false);
  });

  it('runs until stopped when there is no end date', () => {
    expect(campaignPhase(window({ endsAt: null }), at('2030-01-01T00:00:00Z'))).toBe('ACTIVE');
  });

  it('a draft is never live, whatever the dates say', () => {
    expect(campaignPhase(window({ status: 'DRAFT' }), at('2026-12-10T00:00:00Z'))).toBe('DRAFT');
    expect(isCampaignLive(window({ status: 'DRAFT' }), at('2026-12-10T00:00:00Z'))).toBe(false);
  });

  it('a cancelled campaign stays cancelled inside its own window', () => {
    expect(campaignPhase(window({ status: 'CANCELLED' }), at('2026-12-10T00:00:00Z'))).toBe('CANCELLED');
  });
});

describe('campaignPriceFor', () => {
  it('takes a percentage off, rounded to something chargeable', () => {
    expect(campaignPriceFor(10_000, 'PERCENT_OFF', 20)).toBe(8_000);
    expect(campaignPriceFor(999.99, 'PERCENT_OFF', 33)).toBe(669.99);
  });

  it('takes an amount off', () => {
    expect(campaignPriceFor(10_000, 'FIXED_OFF', 2_500)).toBe(7_500);
  });

  it('never goes below zero', () => {
    expect(campaignPriceFor(1_500, 'FIXED_OFF', 2_000)).toBe(0);
    expect(campaignPriceFor(1_500, 'PERCENT_OFF', 150)).toBe(0);
  });

  it('returns null when the discount changes nothing', () => {
    // Otherwise the product is listed under a "SALE" banner at its usual price.
    expect(campaignPriceFor(10_000, 'PERCENT_OFF', 0)).toBeNull();
    expect(campaignPriceFor(10_000, 'FIXED_OFF', 0)).toBeNull();
    expect(campaignPriceFor(0, 'PERCENT_OFF', 50)).toBeNull();
  });
});

describe('bestPrice', () => {
  it('gives the shopper the lower of two overlapping sales', () => {
    const winner = bestPrice([
      { campaignId: 'a', price: 8_000, originalPrice: 10_000 },
      { campaignId: 'b', price: 7_500, originalPrice: 10_000 },
    ]);
    expect(winner?.campaignId).toBe('b');
  });

  it('is null when nothing applies', () => {
    expect(bestPrice([])).toBeNull();
  });
});
