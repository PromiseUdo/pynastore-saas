/*
 * lib/billing/entitlements.ts
 *
 * Resolves what the current organization is entitled to under its plan.
 * Mirrors lib/organization.ts / lib/permissions.ts conventions: cached
 * per-request, never resolve plan/feature access ad-hoc.
 */
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { PLANS, planHasFeature, getPlanLimit, type FeatureKey, type PlanLimits } from '@/lib/billing/plans';
import type { OrganizationPlan } from '@/lib/generated/prisma/enums';

export type OrganizationEntitlements = {
  plan: OrganizationPlan;
  planConfig: (typeof PLANS)[OrganizationPlan];
  subscription: {
    status: string;
    billingCycle: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
  } | null;
};

export const getOrganizationEntitlements = cache(
  async (): Promise<OrganizationEntitlements> => {
    const ctx = await getOrganizationContext();

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: ctx.organization.id },
      select: {
        status: true,
        billingCycle: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
        plan: true,
      },
    });

    // No background worker in this app — lazily treat a canceled
    // subscription past its period end as expired back to Free.
    const expired =
      subscription?.cancelAtPeriodEnd &&
      subscription.currentPeriodEnd !== null &&
      subscription.currentPeriodEnd < new Date();

    const plan: OrganizationPlan = expired
      ? 'FREE'
      : (ctx.organization.plan as OrganizationPlan);

    return {
      plan,
      planConfig: PLANS[plan],
      subscription: subscription
        ? {
            status: expired ? 'CANCELED' : subscription.status,
            billingCycle: subscription.billingCycle,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
    };
  },
);

export function hasFeature(plan: OrganizationPlan, feature: FeatureKey): boolean {
  return planHasFeature(plan, feature);
}

/** Server-side gate for a whole page/module. Redirects to the upgrade page if missing. */
export async function requireFeature(feature: FeatureKey): Promise<void> {
  const { plan } = await getOrganizationEntitlements();
  if (!hasFeature(plan, feature)) {
    redirect(`/upgrade?feature=${encodeURIComponent(feature)}`);
  }
}

export class UsageLimitExceededError extends Error {
  constructor(public readonly limitKey: keyof PlanLimits, public readonly limit: number) {
    super(`Usage limit exceeded: ${limitKey} (max ${limit})`);
    this.name = 'UsageLimitExceededError';
  }
}

/** Throws UsageLimitExceededError if the org has no more seats available on its plan. */
export async function requireSeatAvailable(): Promise<void> {
  const ctx = await getOrganizationContext();
  const { plan } = await getOrganizationEntitlements();
  const maxSeats = getPlanLimit(plan, 'maxSeats');
  if (maxSeats === null) return;

  const [activeMembers, pendingInvites] = await Promise.all([
    prisma.membership.count({
      where: { organizationId: ctx.organization.id, status: 'ACTIVE' },
    }),
    prisma.invitation.count({
      where: {
        organizationId: ctx.organization.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  if (activeMembers + pendingInvites >= maxSeats) {
    throw new UsageLimitExceededError('maxSeats', maxSeats);
  }
}
