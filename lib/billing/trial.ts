/*
 * lib/billing/trial.ts
 *
 * Every new workspace starts with a subscription (ROADMAP 12.1): a free trial
 * of the plan and length set by platform staff, with no card taken — or, for
 * an owner who has already had a trial, none: a workspace created only to
 * restart a trial doesn't get another. That second workspace opens straight
 * onto "Choose a plan" (it is lapsed from the start, with no grace: there was
 * nothing to lapse from).
 *
 * The owner is the key: a trial is remembered on the subscription
 * (`trialStartedAt`) of any workspace this user owns.
 */
import { prisma } from '@/lib/prisma';
import type { BillingSettings } from '@/lib/settings';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const DAY = 24 * 60 * 60 * 1000;

export type WorkspaceStart =
  | { kind: 'trial'; planName: string; trialEndsAt: Date }
  | { kind: 'no-trial' };

/**
 * Called inside bootstrapOrganization's transaction, after the Owner
 * membership exists. The settings are read before the transaction opens, so
 * it holds no more round trips than it must.
 */
export async function startWorkspaceSubscription(
  tx: Tx,
  input: { organizationId: string; ownerUserId: string; settings: BillingSettings; now?: Date },
): Promise<WorkspaceStart> {
  const now = input.now ?? new Date();

  const hadTrial = await tx.subscription.findFirst({
    where: {
      trialStartedAt: { not: null },
      organizationId: { not: input.organizationId },
      organization: {
        memberships: { some: { userId: input.ownerUserId, role: { isSystem: true, name: 'Owner' } } },
      },
    },
    select: { id: true },
  });

  const { settings } = input;
  const trialPlan = hadTrial
    ? null
    : await tx.billingPlan.findUnique({ where: { key: settings.trialPlanKey }, select: { id: true, name: true } });

  if (!hadTrial && trialPlan && settings.trialDays > 0) {
    const trialEndsAt = new Date(now.getTime() + settings.trialDays * DAY);
    await tx.subscription.create({
      data: {
        organizationId: input.organizationId,
        planId: trialPlan.id,
        status: 'TRIALING',
        trialStartedAt: now,
        trialEndsAt,
      },
    });
    return { kind: 'trial', planName: trialPlan.name, trialEndsAt };
  }

  if (!hadTrial && !trialPlan) {
    console.error(`[billing] The trial plan "${settings.trialPlanKey}" doesn't exist — the new workspace starts without a trial.`);
  }

  // No trial: straight to choosing a plan.
  await tx.subscription.create({
    data: {
      organizationId: input.organizationId,
      planId: null,
      status: 'INCOMPLETE',
      lapsedAt: now,
      graceEndsAt: now,
    },
  });
  return { kind: 'no-trial' };
}
