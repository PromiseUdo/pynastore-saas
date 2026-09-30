'use server';

/*
 * features/platform/plans.ts
 *
 * The plan catalogue, edited in the platform console (ROADMAP 11.7) — and
 * nowhere else. Platform staff only; every function checks.
 *
 * The rules this file keeps:
 * - A price change reaches new subscriptions and plan changes only. Current
 *   subscribers keep the amount on their Subscription and their Paystack plan
 *   (keyed by amount, lib/billing/paystack.ts) until they change plan.
 * - Taking a feature away from a plan with workspaces on it needs an explicit
 *   confirmation (`confirmFeatureRemoval`), after the editor has shown how many
 *   workspaces lose it; they lose it on their next request.
 * - A plan with subscribers or payment history is never deleted, only taken
 *   off sale. The free trial's plan can be neither, until another is chosen.
 * - Every change is written to the platform audit log, with before and
 *   after, in the same transaction as the change.
 */
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { writePlatformAudit } from '@/lib/platform-audit';
import { getBillingSettings } from '@/lib/settings';
import { isFeatureKey, type BillingCycleKey, type FeatureKey } from '@/lib/billing/plans';
import {
  draftPrices,
  keyFromName,
  planChanges,
  pricesChanged,
  removedFeatures,
  validatePlanDraft,
  type PlanDraft,
  type PlanDraftErrors,
} from '@/lib/billing/plan-edit';

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: PlanDraftErrors; needsConfirmation?: boolean };

export interface ConsolePlanRow {
  id: string;
  name: string;
  tagline: string;
  isOnSale: boolean;
  highlighted: boolean;
  isTrialPlan: boolean;
  prices: { cycle: BillingCycleKey; amount: number; discountPct: number }[];
  featureCount: number;
  maxSeats: number | null;
  maxWarehouses: number | null;
  /** workspaces on this plan, in any state */
  workspaces: number;
}

export interface ConsolePlan {
  id: string;
  key: string;
  draft: PlanDraft;
  isOnSale: boolean;
  isTrialPlan: boolean;
  /** workspaces on this plan, in any state — all lose a feature taken away */
  workspaces: number;
  /** of those, paying for it now — they keep their current price */
  paying: number;
  /** can be deleted: never subscribed to, never charged, not the trial plan */
  deletable: boolean;
}

export interface PlatformChange {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  /** the plan's name at the time, where there is one */
  subject: string | null;
  staffName: string | null;
  createdAt: Date;
}

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') {
    return { success: false, error: 'Only platform staff can do this' };
  }
  console.error(`[platform/plans] ${fallback}:`, error);
  return { success: false, error: fallback };
}

const PLAN_INCLUDE = {
  prices: { select: { billingCycle: true, discountPct: true, amount: true } },
  features: { select: { feature: true } },
} as const;

type PlanRow = {
  id: string;
  key: string;
  name: string;
  tagline: string;
  monthlyPrice: { toString(): string };
  highlighted: boolean;
  isOnSale: boolean;
  maxSeats: number | null;
  maxWarehouses: number | null;
  prices: { billingCycle: string; discountPct: number; amount: { toString(): string } }[];
  features: { feature: string }[];
};

function toDraft(row: PlanRow): PlanDraft {
  const pct = (cycle: BillingCycleKey) => row.prices.find((p) => p.billingCycle === cycle)?.discountPct ?? 0;
  return {
    name: row.name,
    tagline: row.tagline,
    monthlyPrice: Number(row.monthlyPrice),
    discounts: { BIANNUAL: pct('BIANNUAL'), YEARLY: pct('YEARLY') },
    features: row.features.map((f) => f.feature).filter(isFeatureKey) as FeatureKey[],
    maxSeats: row.maxSeats,
    maxWarehouses: row.maxWarehouses,
    highlighted: row.highlighted,
  };
}

const onPlan = (planId: string) => ({ planId, organization: { status: { not: 'DELETED' as const } } });

/* ---------------- reading ---------------- */

export async function listConsolePlans(): Promise<ActionResult<ConsolePlanRow[]>> {
  try {
    await requirePlatformStaff();
    const [rows, settings, counts] = await Promise.all([
      prisma.billingPlan.findMany({ include: PLAN_INCLUDE, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      getBillingSettings(),
      prisma.subscription.groupBy({
        by: ['planId'],
        where: { planId: { not: null }, organization: { status: { not: 'DELETED' } } },
        _count: { _all: true },
      }),
    ]);
    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        tagline: row.tagline,
        isOnSale: row.isOnSale,
        highlighted: row.highlighted,
        isTrialPlan: row.key === settings.trialPlanKey,
        prices: draftPrices(toDraft(row)),
        featureCount: row.features.filter((f) => isFeatureKey(f.feature)).length,
        maxSeats: row.maxSeats,
        maxWarehouses: row.maxWarehouses,
        workspaces: counts.find((c) => c.planId === row.id)?._count._all ?? 0,
      })),
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the plans');
  }
}

export async function getConsolePlan(planId: string): Promise<ActionResult<ConsolePlan | null>> {
  try {
    await requirePlatformStaff();
    const [row, settings] = await Promise.all([
      prisma.billingPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE }),
      getBillingSettings(),
    ]);
    if (!row) return { success: true, data: null };
    const [workspaces, paying, everSubscribed, charged] = await Promise.all([
      prisma.subscription.count({ where: onPlan(row.id) }),
      prisma.subscription.count({ where: { ...onPlan(row.id), status: { in: ['ACTIVE', 'PAST_DUE'] } } }),
      prisma.subscription.count({ where: { planId: row.id } }),
      prisma.billingTransaction.count({ where: { planId: row.id } }),
    ]);
    const isTrialPlan = row.key === settings.trialPlanKey;
    return {
      success: true,
      data: {
        id: row.id,
        key: row.key,
        draft: toDraft(row),
        isOnSale: row.isOnSale,
        isTrialPlan,
        workspaces,
        paying,
        deletable: everSubscribed === 0 && charged === 0 && !isTrialPlan,
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load this plan');
  }
}

/** The latest console changes, newest first. */
export async function listPlatformChanges(limit = 10): Promise<ActionResult<PlatformChange[]>> {
  try {
    await requirePlatformStaff();
    const rows = await prisma.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    });
    return {
      success: true,
      data: rows.map((r) => {
        const meta = (r.metadata ?? {}) as { name?: unknown };
        return {
          id: r.id,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          subject: typeof meta.name === 'string' ? meta.name : null,
          staffName: r.user?.name ?? r.user?.email ?? null,
          createdAt: r.createdAt,
        };
      }),
    };
  } catch (error) {
    return denied(error, 'We couldn’t load recent changes');
  }
}

/* ---------------- writing ---------------- */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** A save is a handful of sequential writes; against a remote database that can outrun Prisma's 5-second default. */
const TX = { timeout: 20_000, maxWait: 10_000 } as const;

async function writePricesAndFeatures(tx: Tx, planId: string, draft: PlanDraft) {
  // Rewritten whole: three prices and a handful of features, in four round trips.
  await tx.billingPlanPrice.deleteMany({ where: { planId } });
  await tx.billingPlanPrice.createMany({
    data: draftPrices(draft).map((p) => ({ planId, billingCycle: p.cycle, discountPct: p.discountPct, amount: p.amount })),
  });
  await tx.billingPlanFeature.deleteMany({ where: { planId } });
  if (draft.features.length) {
    await tx.billingPlanFeature.createMany({ data: draft.features.map((feature) => ({ planId, feature })) });
  }
}

/** At most one plan is marked popular: marking one unmarks the rest. */
async function claimHighlight(tx: Tx, planId: string, draft: PlanDraft) {
  if (draft.highlighted) {
    await tx.billingPlan.updateMany({ where: { id: { not: planId }, highlighted: true }, data: { highlighted: false } });
  }
}

export async function createPlan(input: PlanDraft): Promise<ActionResult<{ planId: string }>> {
  try {
    const staff = await requirePlatformStaff();
    const checked = validatePlanDraft(input);
    if (!checked.ok) return { success: false, error: 'Check the highlighted fields.', fieldErrors: checked.errors };
    const draft = checked.value;

    const planId = await prisma.$transaction(async (tx) => {
      const [taken, last] = await Promise.all([
        tx.billingPlan.findMany({ select: { key: true } }),
        tx.billingPlan.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } }),
      ]);
      const plan = await tx.billingPlan.create({
        data: {
          key: keyFromName(draft.name, taken.map((t) => t.key)),
          name: draft.name,
          tagline: draft.tagline,
          monthlyPrice: draft.monthlyPrice,
          highlighted: draft.highlighted,
          sortOrder: (last?.sortOrder ?? 0) + 1,
          // A new plan starts off sale, so it can be checked before merchants see it.
          isOnSale: false,
          maxSeats: draft.maxSeats,
          maxWarehouses: draft.maxWarehouses,
        },
      });
      await claimHighlight(tx, plan.id, draft);
      await writePricesAndFeatures(tx, plan.id, draft);
      await writePlatformAudit(tx, {
        userId: staff.userId,
        action: 'platform.plan.created',
        entityType: 'BillingPlan',
        entityId: plan.id,
        metadata: { name: draft.name, after: { ...draft, prices: draftPrices(draft) } } as never,
      });
      return plan.id;
    }, TX);

    return { success: true, data: { planId } };
  } catch (error) {
    return denied(error, 'We couldn’t create the plan');
  }
}

export async function updatePlan(
  planId: string,
  input: PlanDraft,
  options: { confirmFeatureRemoval?: boolean } = {},
): Promise<ActionResult<{ pricesChanged: boolean; removed: FeatureKey[] }>> {
  try {
    const staff = await requirePlatformStaff();
    const checked = validatePlanDraft(input);
    if (!checked.ok) return { success: false, error: 'Check the highlighted fields.', fieldErrors: checked.errors };
    const draft = checked.value;

    const row = await prisma.billingPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
    if (!row) return { success: false, error: 'This plan no longer exists.' };
    const before = toDraft(row);

    const removed = removedFeatures(before.features, draft.features);
    if (removed.length && !options.confirmFeatureRemoval) {
      const workspaces = await prisma.subscription.count({ where: onPlan(planId) });
      if (workspaces > 0) {
        return {
          success: false,
          needsConfirmation: true,
          error: `${workspaces} workspace${workspaces === 1 ? '' : 's'} on this plan would lose ${removed.length === 1 ? 'a feature' : 'features'}. Confirm to go ahead.`,
        };
      }
    }

    const changes = planChanges(before, draft);
    if (Object.keys(changes).length === 0) {
      return { success: true, data: { pricesChanged: false, removed: [] } };
    }
    const repriced = pricesChanged(before, draft);

    await prisma.$transaction(async (tx) => {
      await tx.billingPlan.update({
        where: { id: planId },
        data: {
          name: draft.name,
          tagline: draft.tagline,
          monthlyPrice: draft.monthlyPrice,
          highlighted: draft.highlighted,
          maxSeats: draft.maxSeats,
          maxWarehouses: draft.maxWarehouses,
        },
      });
      await claimHighlight(tx, planId, draft);
      await writePricesAndFeatures(tx, planId, draft);
      await writePlatformAudit(tx, {
        userId: staff.userId,
        action: 'platform.plan.updated',
        entityType: 'BillingPlan',
        entityId: planId,
        metadata: {
          name: draft.name,
          changes,
          ...(repriced ? { prices: { before: draftPrices(before), after: draftPrices(draft) } } : {}),
        } as never,
      });
    }, TX);

    return { success: true, data: { pricesChanged: repriced, removed } };
  } catch (error) {
    return denied(error, 'We couldn’t save the plan');
  }
}

/** Takes a plan off sale (its subscribers keep it) or puts it back. */
export async function setPlanOnSale(planId: string, onSale: boolean): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const [row, settings] = await Promise.all([
      prisma.billingPlan.findUnique({ where: { id: planId }, select: { key: true, name: true, isOnSale: true } }),
      getBillingSettings(),
    ]);
    if (!row) return { success: false, error: 'This plan no longer exists.' };
    if (row.isOnSale === onSale) return { success: true, data: undefined };
    if (!onSale && row.key === settings.trialPlanKey) {
      return {
        success: false,
        error: 'New workspaces get this plan as their free trial. Choose a different trial plan in Billing settings first.',
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.billingPlan.update({ where: { id: planId }, data: { isOnSale: onSale } });
      await writePlatformAudit(tx, {
        userId: staff.userId,
        action: onSale ? 'platform.plan.restored' : 'platform.plan.retired',
        entityType: 'BillingPlan',
        entityId: planId,
        metadata: { name: row.name, before: { isOnSale: row.isOnSale }, after: { isOnSale: onSale } },
      });
    }, TX);
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t change whether this plan is on sale');
  }
}

/** Moves a plan one place up or down the order merchants see. */
export async function movePlan(planId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    await prisma.$transaction(async (tx) => {
      const plans = await tx.billingPlan.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, sortOrder: true },
      });
      const from = plans.findIndex((p) => p.id === planId);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= plans.length) return;

      // Renumber the whole list so ties from hand-edited rows can't stall a move.
      const order = [...plans];
      [order[from], order[to]] = [order[to], order[from]];
      for (let i = 0; i < order.length; i++) {
        if (order[i].sortOrder !== i + 1) {
          await tx.billingPlan.update({ where: { id: order[i].id }, data: { sortOrder: i + 1 } });
        }
      }
      await writePlatformAudit(tx, {
        userId: staff.userId,
        action: 'platform.plan.reordered',
        entityType: 'BillingPlan',
        entityId: planId,
        metadata: { name: plans[from].name, before: { position: from + 1 }, after: { position: to + 1 } },
      });
    }, TX);
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t move the plan');
  }
}

/** Deletes a plan nobody has ever subscribed to or paid for — a mistake, not a retirement. */
export async function deletePlan(planId: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const [row, settings] = await Promise.all([
      prisma.billingPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE }),
      getBillingSettings(),
    ]);
    if (!row) return { success: true, data: undefined };
    if (row.key === settings.trialPlanKey) {
      return { success: false, error: 'New workspaces get this plan as their free trial, so it can’t be deleted.' };
    }
    const [subscribed, charged] = await Promise.all([
      prisma.subscription.count({ where: { planId } }),
      prisma.billingTransaction.count({ where: { planId } }),
    ]);
    if (subscribed > 0 || charged > 0) {
      return { success: false, error: 'This plan has been used, so it can’t be deleted. Take it off sale instead.' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.billingPlanCode.deleteMany({ where: { planId } });
      await tx.billingPlan.delete({ where: { id: planId } });
      await writePlatformAudit(tx, {
        userId: staff.userId,
        action: 'platform.plan.deleted',
        entityType: 'BillingPlan',
        entityId: planId,
        metadata: { name: row.name, before: { ...toDraft(row) } } as never,
      });
    }, TX);
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t delete the plan');
  }
}
