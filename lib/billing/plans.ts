// lib/billing/plans.ts
// Plan/feature catalog — all pricing, features, and usage limits per plan
// are defined here as typed constants. Single source of truth for the
// pricing page, feature gating, and usage-limit enforcement.
// Mirrors the conventions of lib/permissions.ts.

import type { OrganizationPlan } from '@/lib/generated/prisma/enums';

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

export type PlanLimits = {
  /** null = unlimited */
  maxSeats: number | null;
  maxWarehouses: number | null;
  maxProjects: number | null;
};

export type PlanConfig = {
  key: OrganizationPlan;
  name: string;
  tagline: string;
  /** Monthly price in NGN major units. Placeholder — change only here. */
  monthlyPrice: number;
  features: FeatureKey[];
  limits: PlanLimits;
  highlighted?: boolean;
};

export const PLAN_ORDER: OrganizationPlan[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];

/** Yearly billing discount: 2 months free (~17% off monthly x 12). */
export function getYearlyPrice(monthlyPrice: number): number {
  return Math.round(monthlyPrice * 10);
}

const starterFeatures: FeatureKey[] = [
  FEATURES.PROCUREMENT_MODULE,
  FEATURES.INVENTORY_MODULE,
  FEATURES.SALES_MODULE,
  FEATURES.CUSTOM_ROLES,
];

const proFeatures: FeatureKey[] = [
  ...starterFeatures,
  FEATURES.INVENTORY_MULTI_WAREHOUSE,
  FEATURES.INVENTORY_KITS,
  FEATURES.PROCUREMENT_AUTO_REORDER,
  FEATURES.REPORTS_ADVANCED,
  FEATURES.AUDIT_LOG_EXPORT,
];

const enterpriseFeatures: FeatureKey[] = [...proFeatures, FEATURES.API_ACCESS];

export const PLANS: Record<OrganizationPlan, PlanConfig> = {
  FREE: {
    key: 'FREE',
    name: 'Free',
    tagline: 'Get started with the essentials',
    monthlyPrice: 0,
    features: [],
    limits: { maxSeats: 3, maxWarehouses: 1, maxProjects: 3 },
  },
  STARTER: {
    key: 'STARTER',
    name: 'Starter',
    tagline: 'For small teams running real operations',
    monthlyPrice: 15000,
    features: starterFeatures,
    limits: { maxSeats: 10, maxWarehouses: 1, maxProjects: null },
  },
  PRO: {
    key: 'PRO',
    name: 'Pro',
    tagline: 'Scale across warehouses and teams',
    monthlyPrice: 45000,
    features: proFeatures,
    limits: { maxSeats: 50, maxWarehouses: null, maxProjects: null },
    highlighted: true,
  },
  ENTERPRISE: {
    key: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Unlimited scale, API access, priority support',
    monthlyPrice: 150000,
    features: enterpriseFeatures,
    limits: { maxSeats: null, maxWarehouses: null, maxProjects: null },
  },
};

export function planHasFeature(plan: OrganizationPlan, feature: FeatureKey): boolean {
  return PLANS[plan].features.includes(feature);
}

export function getPlanLimit(plan: OrganizationPlan, key: keyof PlanLimits): number | null {
  return PLANS[plan].limits[key];
}

export function isPlanAtLeast(plan: OrganizationPlan, target: OrganizationPlan): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(target);
}
