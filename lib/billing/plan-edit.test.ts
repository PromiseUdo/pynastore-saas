/* The console's plan-editing rules (ROADMAP 11.7) — pure. */
import { describe, expect, it } from 'vitest';
import {
  SELLABLE_FEATURES,
  draftPrices,
  keyFromName,
  planChanges,
  pricesChanged,
  removedFeatures,
  validatePlanDraft,
  type PlanDraft,
} from './plan-edit';

const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  name: 'Growth',
  tagline: 'For a busy shop',
  monthlyPrice: 20000,
  discounts: { BIANNUAL: 10, YEARLY: 17 },
  features: ['inventory.module', 'sales.module'],
  maxSeats: 10,
  maxWarehouses: 2,
  highlighted: false,
  ...over,
});

describe('validatePlanDraft', () => {
  it('accepts a sound plan and tidies it', () => {
    const r = validatePlanDraft(draft({ name: '  Growth   plus ', features: ['sales.module', 'inventory.module', 'sales.module'] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Growth plus');
      expect(r.value.features).toEqual(['inventory.module', 'sales.module']);
    }
  });

  it('names each problem beside its field', () => {
    const r = validatePlanDraft(
      draft({ name: ' ', monthlyPrice: 50, discounts: { BIANNUAL: -1, YEARLY: 95 }, maxSeats: 0, maxWarehouses: 1.5 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ['discounts.BIANNUAL', 'discounts.YEARLY', 'maxSeats', 'maxWarehouses', 'monthlyPrice', 'name'].sort(),
      );
    }
  });

  it('refuses a price that isn’t whole naira', () => {
    expect(validatePlanDraft(draft({ monthlyPrice: 5000.5 })).ok).toBe(false);
    expect(validatePlanDraft(draft({ monthlyPrice: NaN })).ok).toBe(false);
  });

  it('never sells a feature that isn’t built', () => {
    expect(SELLABLE_FEATURES).not.toContain('api.access');
    const r = validatePlanDraft(draft({ features: ['inventory.module', 'api.access'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.features).toBeTruthy();
  });

  it('allows unlimited limits', () => {
    expect(validatePlanDraft(draft({ maxSeats: null, maxWarehouses: null })).ok).toBe(true);
  });
});

describe('prices and changes', () => {
  it('shows each cycle’s price from the one formula', () => {
    expect(draftPrices(draft())).toEqual([
      { cycle: 'MONTHLY', discountPct: 0, amount: 20000 },
      { cycle: 'BIANNUAL', discountPct: 10, amount: 108000 },
      { cycle: 'YEARLY', discountPct: 17, amount: 199200 },
    ]);
  });

  it('knows a price changed only when some cycle costs something different', () => {
    expect(pricesChanged(draft(), draft({ name: 'Other' }))).toBe(false);
    expect(pricesChanged(draft(), draft({ discounts: { BIANNUAL: 10, YEARLY: 20 } }))).toBe(true);
  });

  it('lists what changed, with before and after', () => {
    const changes = planChanges(draft(), draft({ name: 'Growth+', features: ['inventory.module'], maxSeats: null }));
    expect(changes).toEqual({
      name: { before: 'Growth', after: 'Growth+' },
      maxSeats: { before: 10, after: null },
      features: { before: ['inventory.module', 'sales.module'], after: ['inventory.module'] },
    });
    expect(removedFeatures(['inventory.module', 'sales.module'], ['inventory.module'])).toEqual(['sales.module']);
    expect(planChanges(draft(), draft())).toEqual({});
  });
});

describe('keyFromName', () => {
  it('makes a stable, unique key', () => {
    expect(keyFromName('Pro Plus!', [])).toBe('pro-plus');
    expect(keyFromName('Pro', ['pro', 'pro-2'])).toBe('pro-3');
    expect(keyFromName('₦₦', [])).toBe('plan');
  });
});
