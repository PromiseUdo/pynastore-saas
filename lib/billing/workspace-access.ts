/*
 * lib/billing/workspace-access.ts
 *
 * Any workspace's plan and access state, by organisation id (ROADMAP 12.1) —
 * for places with no signed-in merchant: the storefront, order placement,
 * tests. Kept apart from ./entitlements.ts, which reads the request's
 * organisation context (and so the auth stack), so the storefront never pulls
 * that in.
 *
 * A lapse is RECORDED the first time it's found, with the grace days in force
 * at that moment — so changing the setting later never moves a merchant's
 * deadline.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { getBillingSettings } from '@/lib/settings';
import { loadEffectivePlan } from './catalogue';
import { NO_PLAN, type EffectivePlan } from './plans';
import { resolveAccess, storefrontOpen, type AccessState, type SubscriptionStatusKey } from './access';

export interface WorkspaceAccess {
  state: AccessState;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
}

export type OrganizationEntitlements = {
  plan: EffectivePlan;
  access: WorkspaceAccess;
  subscription: {
    planId: string | null;
    status: SubscriptionStatusKey;
    billingCycle: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    /** what this workspace pays per cycle; null on a trial */
    amount: number | null;
  } | null;
};

/**
 * Any workspace's plan and access — by id, for places without an org context
 * (the storefront, order placement, tests). Records a newly found lapse.
 */
export async function entitlementsFor(organizationId: string, now = new Date()): Promise<OrganizationEntitlements> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: {
      id: true,
      planId: true,
      status: true,
      billingCycle: true,
      amount: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      lapsedAt: true,
      graceEndsAt: true,
    },
  });

  if (!subscription) {
    // Old test data only: every workspace since 12.1 is created with one.
    return { plan: NO_PLAN, access: { state: 'none', trialEndsAt: null, graceEndsAt: null }, subscription: null };
  }

  const { graceDays } = await getBillingSettings();
  const resolved = resolveAccess(subscription, now, graceDays);

  if (resolved.toRecord) {
    // Claimed on lapsedAt being empty, so two requests record one deadline.
    await prisma.subscription.updateMany({
      where: { id: subscription.id, lapsedAt: null },
      data: resolved.toRecord,
    });
  }

  const plan = (subscription.planId ? await loadEffectivePlan(subscription.planId) : null) ?? NO_PLAN;

  return {
    plan,
    access: { state: resolved.state, trialEndsAt: resolved.trialEndsAt, graceEndsAt: resolved.graceEndsAt },
    subscription: {
      planId: subscription.planId,
      status: subscription.status,
      billingCycle: subscription.billingCycle,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodEnd: subscription.currentPeriodEnd,
      amount: subscription.amount === null ? null : Number(subscription.amount),
    },
  };
}

/** Just the access state of any workspace — the storefront's question. */
export async function accessFor(organizationId: string): Promise<WorkspaceAccess> {
  return (await entitlementsFor(organizationId)).access;
}

/**
 * Whether a workspace's storefront takes orders (ROADMAP 12.1): open in every
 * state but `lapsed` — through a trial, a paid plan and the grace period.
 * Once per request, since the storefront layout and its pages both ask.
 */
export const storefrontIsOpen = cache(async (organizationId: string): Promise<boolean> => {
  return storefrontOpen((await accessFor(organizationId)).state);
});
