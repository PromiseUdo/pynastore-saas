// lib/billing/plans.ts
//
// The RULES of the plan catalogue — pure and client-safe (ROADMAP 12.1).
//
// The catalogue itself (which plans exist, their prices, which features and
// limits each includes) lives in the DATABASE (BillingPlan and friends), so
// platform staff can change it without a deploy (11.7). What stays in code is
// what the code depends on:
//   - FEATURES, the registry of things the code gates on. The console only
//     chooses which plans include which feature; it can't invent one, and it
//     can't sell one that isn't built (FEATURE_INFO.built).
//   - the limits the code enforces, and the billing cycles Paystack supports;
//   - how a cycle's price is worked out from the monthly price and a discount.
//
// DEFAULT_CATALOGUE is only the starting point the migration seeded; nothing
// reads it at runtime.

export const FEATURES = {
  PROCUREMENT_MODULE: 'procurement.module',
  INVENTORY_MODULE: 'inventory.module',
  INVENTORY_MULTI_WAREHOUSE: 'inventory.multi_warehouse',
  INVENTORY_KITS: 'inventory.kits',
  PROCUREMENT_AUTO_REORDER: 'procurement.auto_reorder',
  SALES_MODULE: 'sales.module',
  CUSTOM_ROLES: 'roles.custom',
  REPORTS_ADVANCED: 'reports.advanced',
  AUDIT_LOG_EXPORT: 'audit_log.export',
  API_ACCESS: 'api.access',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export const FEATURE_KEYS = Object.values(FEATURES) as FeatureKey[];

/**
 * What each feature is called on the pricing page, in one line, and whether
 * it exists yet. An unbuilt feature is never sold (ROADMAP 12.1, 12.4).
 */
export const FEATURE_INFO: Record<FeatureKey, { label: string; description: string; built: boolean }> = {
  'inventory.module': { label: 'Inventory', description: 'Products, stock and stores', built: true },
  'sales.module': { label: 'Sales', description: 'Orders, customers, invoices and quotes', built: true },
  'procurement.module': { label: 'Purchasing', description: 'Suppliers and purchase orders', built: true },
  'roles.custom': { label: 'Custom roles', description: 'Decide exactly what each member can do', built: true },
  'inventory.multi_warehouse': { label: 'More than one store', description: 'Stock and sell from several stores', built: true },
  'inventory.kits': { label: 'Kits and bundles', description: 'Sell products made of other products', built: true },
  'procurement.auto_reorder': { label: 'Restocking suggestions', description: 'Purchase orders drafted from low stock', built: true },
  'reports.advanced': { label: 'Advanced reports', description: 'Sales, margins and store comparisons', built: true },
  'audit_log.export': { label: 'Activity log download', description: 'Export who did what, when', built: true },
  'api.access': { label: 'API access', description: 'Connect your own systems', built: false },
};

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as string[]).includes(value);
}

/** null = unlimited. */
export type PlanLimits = {
  maxSeats: number | null;
  maxWarehouses: number | null;
};

export const LIMIT_INFO: Record<keyof PlanLimits, { label: (n: number | null) => string }> = {
  maxSeats: { label: (n) => (n === null ? 'Unlimited team members' : `${n} team member${n === 1 ? '' : 's'}`) },
  maxWarehouses: { label: (n) => (n === null ? 'Unlimited stores' : `${n} store${n === 1 ? '' : 's'}`) },
};

/* ---------------- billing cycles ---------------- */

export type BillingCycleKey = 'MONTHLY' | 'BIANNUAL' | 'YEARLY';

/**
 * The cycles Paystack's plan API offers that we sell (ROADMAP 12.1): there is
 * no quarterly interval. Screens say "Every 6 months", never "biannual",
 * which people read both ways.
 */
export const CYCLES: Record<BillingCycleKey, { months: number; label: string; per: string; paystackInterval: string }> = {
  MONTHLY: { months: 1, label: 'Monthly', per: 'month', paystackInterval: 'monthly' },
  BIANNUAL: { months: 6, label: 'Every 6 months', per: '6 months', paystackInterval: 'biannually' },
  YEARLY: { months: 12, label: 'Yearly', per: 'year', paystackInterval: 'annually' },
};

export const CYCLE_ORDER: BillingCycleKey[] = ['MONTHLY', 'BIANNUAL', 'YEARLY'];

/**
 * A cycle's price: the monthly price times the months, less its discount,
 * rounded to the naira. The one formula — the catalogue stores its result, and
 * the console (11.7) uses it to show a price before saving.
 */
export function cyclePrice(monthlyPrice: number, cycle: BillingCycleKey, discountPct: number): number {
  const full = monthlyPrice * CYCLES[cycle].months;
  return Math.round(full * (1 - Math.min(Math.max(discountPct, 0), 90) / 100));
}

/**
 * When a period that starts at `from` ends: the same day, `months` later —
 * or that month's last day, so 31 January runs to 28/29 February rather than
 * spilling into March.
 */
export function periodEnd(cycle: BillingCycleKey | string, from: Date): Date {
  const months = CYCLES[cycle as BillingCycleKey]?.months ?? 1;
  const end = new Date(from);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

/* ---------------- a plan, as the code gates on it ---------------- */

/**
 * A plan loaded from the catalogue, or NO_PLAN. `hasFeature` and
 * `getPlanLimit` (lib/billing/entitlements.ts) read this — every call site
 * keeps its shape; only the source moved from constants to the database.
 */
export interface EffectivePlan {
  id: string | null;
  key: string | null;
  name: string;
  features: FeatureKey[];
  limits: PlanLimits;
  sortOrder: number;
}

/**
 * A workspace with no plan: nothing unlocked. Every workspace created since
 * ROADMAP 12.1 has a subscription (a trial at least); this is what old test
 * data without one gets.
 */
export const NO_PLAN: EffectivePlan = {
  id: null,
  key: null,
  name: 'No plan',
  features: [],
  limits: { maxSeats: 3, maxWarehouses: 1 },
  sortOrder: -1,
};

export function planHasFeature(plan: EffectivePlan, feature: FeatureKey): boolean {
  return plan.features.includes(feature);
}

export function getPlanLimit(plan: EffectivePlan, key: keyof PlanLimits): number | null {
  return plan.limits[key];
}

/* ---------------- the seeded starting catalogue ---------------- */

export interface CatalogueSeedPlan {
  key: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  highlighted: boolean;
  sortOrder: number;
  features: FeatureKey[];
  limits: PlanLimits;
}

const starter: FeatureKey[] = [
  FEATURES.INVENTORY_MODULE,
  FEATURES.SALES_MODULE,
  FEATURES.PROCUREMENT_MODULE,
  FEATURES.CUSTOM_ROLES,
];
const pro: FeatureKey[] = [
  ...starter,
  FEATURES.INVENTORY_MULTI_WAREHOUSE,
  FEATURES.INVENTORY_KITS,
  FEATURES.PROCUREMENT_AUTO_REORDER,
  FEATURES.REPORTS_ADVANCED,
  FEATURES.AUDIT_LOG_EXPORT,
];

/**
 * Seeded by migration 20260930090000_plan_catalogue. Starter is ₦5,000 a
 * month (ROADMAP 12.1); API access is left off Enterprise because it isn't
 * built. Everything here is editable in the console (11.7).
 */
export const DEFAULT_CATALOGUE: CatalogueSeedPlan[] = [
  {
    key: 'starter',
    name: 'Starter',
    tagline: 'For a small shop getting started',
    monthlyPrice: 5000,
    highlighted: false,
    sortOrder: 1,
    features: starter,
    limits: { maxSeats: 10, maxWarehouses: 1 },
  },
  {
    key: 'pro',
    name: 'Pro',
    tagline: 'Sell from several stores, with the full toolkit',
    monthlyPrice: 45000,
    highlighted: true,
    sortOrder: 2,
    features: pro,
    limits: { maxSeats: 50, maxWarehouses: null },
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    tagline: 'Unlimited team and stores',
    monthlyPrice: 150000,
    highlighted: false,
    sortOrder: 3,
    features: pro,
    limits: { maxSeats: null, maxWarehouses: null },
  },
];

/** The seeded discounts: 10% for six months, 17% (about two months free) for a year. */
export const DEFAULT_DISCOUNTS: Record<BillingCycleKey, number> = { MONTHLY: 0, BIANNUAL: 10, YEARLY: 17 };
