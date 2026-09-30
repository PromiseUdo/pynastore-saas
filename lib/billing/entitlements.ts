/*
 * lib/billing/entitlements.ts
 *
 * What the current workspace is entitled to: its plan (features and limits,
 * from the catalogue in the database) and its access state — trial, active,
 * grace or lapsed (ROADMAP 12.1). Cached per request; never resolve plan or
 * feature access ad hoc.
 *
 * The call sites didn't change when plans moved into the database:
 * `hasFeature(plan, …)`, `requireFeature(…)` and `getPlanLimit(plan, …)` read
 * the loaded plan instead of constants.
 *
 * By organisation id, without a request context (the storefront, order
 * placement): ./workspace-access.ts, re-exported here.
 */
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { planHasFeature, getPlanLimit, type EffectivePlan, type FeatureKey, type PlanLimits } from './plans';
import { entitlementsFor, type OrganizationEntitlements } from './workspace-access';

export {
  entitlementsFor,
  accessFor,
  storefrontIsOpen,
  type OrganizationEntitlements,
  type WorkspaceAccess,
} from './workspace-access';

/** The current workspace's entitlements, once per request. */
export const getOrganizationEntitlements = cache(async (): Promise<OrganizationEntitlements> => {
  const ctx = await getOrganizationContext();
  return entitlementsFor(ctx.organization.id);
});

export function hasFeature(plan: EffectivePlan, feature: FeatureKey): boolean {
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
