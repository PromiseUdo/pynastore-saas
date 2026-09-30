/*
 * lib/billing/plan-edit.ts
 *
 * The rules for editing a plan in the platform console (ROADMAP 11.7). Pure
 * and client-safe: the editor checks with them as staff type, and the server
 * action checks again with the same function before anything is written.
 */
import {
  CYCLE_ORDER,
  FEATURE_INFO,
  cyclePrice,
  isFeatureKey,
  type BillingCycleKey,
  type FeatureKey,
} from './plans';

/** A plan as the editor holds it. Money in naira (major units). */
export interface PlanDraft {
  name: string;
  tagline: string;
  monthlyPrice: number;
  /** the discount on each longer cycle, whole percent; monthly is never discounted */
  discounts: { BIANNUAL: number; YEARLY: number };
  features: FeatureKey[];
  /** null = unlimited */
  maxSeats: number | null;
  maxWarehouses: number | null;
  highlighted: boolean;
}

export type PlanDraftField =
  | 'name'
  | 'tagline'
  | 'monthlyPrice'
  | 'discounts.BIANNUAL'
  | 'discounts.YEARLY'
  | 'features'
  | 'maxSeats'
  | 'maxWarehouses';

export type PlanDraftErrors = Partial<Record<PlanDraftField, string>>;

export const PLAN_LIMITS = {
  nameMax: 40,
  taglineMax: 120,
  minMonthlyPrice: 100,
  maxMonthlyPrice: 10_000_000,
  maxDiscountPct: 90,
  maxLimit: 100_000,
} as const;

/** The features that can be sold: known to the code and built (12.1). */
export const SELLABLE_FEATURES = (Object.keys(FEATURE_INFO) as FeatureKey[]).filter((f) => FEATURE_INFO[f].built);

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/**
 * Checks a draft and returns it tidied (trimmed, features de-duplicated and
 * in registry order), or the errors to show beside each field.
 */
export function validatePlanDraft(
  raw: PlanDraft,
): { ok: true; value: PlanDraft } | { ok: false; errors: PlanDraftErrors } {
  const errors: PlanDraftErrors = {};
  const name = String(raw.name ?? '').trim().replace(/\s+/g, ' ');
  const tagline = String(raw.tagline ?? '').trim().replace(/\s+/g, ' ');

  if (!name) errors.name = 'Give the plan a name.';
  else if (name.length > PLAN_LIMITS.nameMax) errors.name = `Keep the name to ${PLAN_LIMITS.nameMax} characters.`;
  if (tagline.length > PLAN_LIMITS.taglineMax) errors.tagline = `Keep the tagline to ${PLAN_LIMITS.taglineMax} characters.`;

  if (!isWhole(raw.monthlyPrice)) errors.monthlyPrice = 'Enter the price in whole naira.';
  else if (raw.monthlyPrice < PLAN_LIMITS.minMonthlyPrice)
    errors.monthlyPrice = `The monthly price must be at least ₦${PLAN_LIMITS.minMonthlyPrice.toLocaleString('en-NG')}.`;
  else if (raw.monthlyPrice > PLAN_LIMITS.maxMonthlyPrice) errors.monthlyPrice = 'That price is too high.';

  for (const cycle of ['BIANNUAL', 'YEARLY'] as const) {
    const pct = raw.discounts?.[cycle];
    if (!isWhole(pct) || pct < 0 || pct > PLAN_LIMITS.maxDiscountPct) {
      errors[`discounts.${cycle}`] = `Enter a whole percentage from 0 to ${PLAN_LIMITS.maxDiscountPct}.`;
    }
  }

  const features = Array.isArray(raw.features) ? raw.features : [];
  const unknown = features.filter((f) => !isFeatureKey(f) || !FEATURE_INFO[f].built);
  if (unknown.length) errors.features = 'Only features that exist can be sold.';

  for (const key of ['maxSeats', 'maxWarehouses'] as const) {
    const v = raw[key];
    if (v === null) continue;
    if (!isWhole(v) || v < 1 || v > PLAN_LIMITS.maxLimit) {
      errors[key] = 'Enter a whole number of at least 1, or choose unlimited.';
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      tagline,
      monthlyPrice: raw.monthlyPrice,
      discounts: { BIANNUAL: raw.discounts.BIANNUAL, YEARLY: raw.discounts.YEARLY },
      features: SELLABLE_FEATURES.filter((f) => features.includes(f)),
      maxSeats: raw.maxSeats,
      maxWarehouses: raw.maxWarehouses,
      highlighted: Boolean(raw.highlighted),
    },
  };
}

/** What each cycle will cost — the one formula (cyclePrice), for the preview and the save. */
export function draftPrices(draft: Pick<PlanDraft, 'monthlyPrice' | 'discounts'>): {
  cycle: BillingCycleKey;
  discountPct: number;
  amount: number;
}[] {
  return CYCLE_ORDER.map((cycle) => {
    const discountPct = cycle === 'MONTHLY' ? 0 : draft.discounts[cycle];
    const monthly = Number.isFinite(draft.monthlyPrice) ? draft.monthlyPrice : 0;
    return { cycle, discountPct, amount: cyclePrice(monthly, cycle, discountPct) };
  });
}

/** Features the draft takes away from the saved plan. */
export function removedFeatures(before: FeatureKey[], after: FeatureKey[]): FeatureKey[] {
  return before.filter((f) => !after.includes(f));
}

/** Whether any cycle's price differs. */
export function pricesChanged(before: PlanDraft, after: PlanDraft): boolean {
  const a = draftPrices(before);
  const b = draftPrices(after);
  return a.some((p, i) => p.amount !== b[i].amount);
}

/** The fields that changed, as { field: { before, after } } — for the audit log. */
export function planChanges(before: PlanDraft, after: PlanDraft): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  for (const key of Object.keys(after) as (keyof PlanDraft)[]) {
    if (key === 'features') continue;
    if (!same(before[key], after[key])) changes[key] = { before: before[key], after: after[key] };
  }
  const added = after.features.filter((f) => !before.features.includes(f));
  const removed = removedFeatures(before.features, after.features);
  if (added.length || removed.length) changes.features = { before: before.features, after: after.features };
  return changes;
}

/**
 * A stable key for a new plan, from its name: lowercase, hyphenated, unique
 * among `taken`. It is never shown and never changes after creation — a plan
 * is renamed freely because nothing refers to it by name.
 */
export function keyFromName(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'plan';
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
