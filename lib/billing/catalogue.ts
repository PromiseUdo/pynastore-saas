/*
 * lib/billing/catalogue.ts
 *
 * Reading the plan catalogue from the database (ROADMAP 12.1). Server only.
 * The rules it follows — features, limits, cycles, prices — are in
 * ./plans.ts; the console (11.7) edits the rows.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import {
  CYCLE_ORDER,
  isFeatureKey,
  type BillingCycleKey,
  type EffectivePlan,
  type FeatureKey,
  type PlanLimits,
} from './plans';

const PLAN_INCLUDE = {
  features: { select: { feature: true } },
  prices: { select: { billingCycle: true, discountPct: true, amount: true } },
} as const;

type PlanRow = {
  id: string;
  key: string;
  name: string;
  tagline: string;
  monthlyPrice: { toString(): string };
  highlighted: boolean;
  sortOrder: number;
  isOnSale: boolean;
  maxSeats: number | null;
  maxWarehouses: number | null;
  features: { feature: string }[];
  prices: { billingCycle: string; discountPct: number; amount: { toString(): string } }[];
};

/** One plan as the pricing screens show it. */
export interface PlanOffer {
  id: string;
  key: string;
  name: string;
  tagline: string;
  highlighted: boolean;
  isOnSale: boolean;
  features: FeatureKey[];
  limits: PlanLimits;
  monthlyPrice: number;
  /** the three cycles, in order; a cycle the plan isn't sold on is absent */
  prices: { cycle: BillingCycleKey; amount: number; discountPct: number }[];
}

function featuresOf(row: PlanRow): FeatureKey[] {
  // A feature key the code no longer knows is ignored rather than trusted.
  return row.features.map((f) => f.feature).filter(isFeatureKey);
}

export function toEffectivePlan(row: PlanRow): EffectivePlan {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    features: featuresOf(row),
    limits: { maxSeats: row.maxSeats, maxWarehouses: row.maxWarehouses },
    sortOrder: row.sortOrder,
  };
}

export function toOffer(row: PlanRow): PlanOffer {
  const prices = CYCLE_ORDER.flatMap((cycle) => {
    const price = row.prices.find((p) => p.billingCycle === cycle);
    return price ? [{ cycle, amount: Number(price.amount), discountPct: price.discountPct }] : [];
  });
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    tagline: row.tagline,
    highlighted: row.highlighted,
    isOnSale: row.isOnSale,
    features: featuresOf(row),
    limits: { maxSeats: row.maxSeats, maxWarehouses: row.maxWarehouses },
    monthlyPrice: Number(row.monthlyPrice),
    prices,
  };
}

/** A plan, loaded for gating — once per request per plan. */
export const loadEffectivePlan = cache(async (planId: string): Promise<EffectivePlan | null> => {
  const row = await prisma.billingPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  return row ? toEffectivePlan(row) : null;
});

/** Plans on sale, cheapest tier first. A retired plan isn't offered. */
export async function listPlansForSale(): Promise<PlanOffer[]> {
  const rows = await prisma.billingPlan.findMany({
    where: { isOnSale: true },
    include: PLAN_INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map(toOffer);
}

/**
 * What a plan costs on a cycle, for a checkout — only for a plan on sale, and
 * only for a cycle it has a price for. Read on the server at the moment of
 * charging; never taken from the browser.
 */
export async function priceForCheckout(
  planId: string,
  cycle: BillingCycleKey,
): Promise<{ plan: PlanOffer; amount: number } | null> {
  const row = await prisma.billingPlan.findFirst({ where: { id: planId, isOnSale: true }, include: PLAN_INCLUDE });
  if (!row) return null;
  const offer = toOffer(row);
  const price = offer.prices.find((p) => p.cycle === cycle);
  return price ? { plan: offer, amount: price.amount } : null;
}

export async function planByKey(key: string): Promise<{ id: string; name: string } | null> {
  return prisma.billingPlan.findUnique({ where: { key }, select: { id: true, name: true } });
}
