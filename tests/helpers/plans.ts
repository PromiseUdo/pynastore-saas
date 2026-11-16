/*
 * Puts a test workspace on a catalogue plan (ROADMAP 12.1). Since the plan
 * lives on the subscription, not on the organisation, a test that needs a
 * feature or a higher limit calls this after creating its organisation.
 * Billing rows deliberately don't cascade with an organisation, so call
 * `dropBilling` in afterAll before deleting it.
 */
import { prisma } from '@/lib/prisma';

const DAY = 24 * 60 * 60 * 1000;

export async function givePlan(organizationId: string, key: 'starter' | 'pro' | 'enterprise' = 'pro') {
  const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { key }, select: { id: true } });
  const now = new Date();
  await prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: plan.id,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * DAY),
    },
    update: {
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: new Date(now.getTime() + 30 * DAY),
      lapsedAt: null,
      graceEndsAt: null,
    },
  });
}

/** Removes a test workspace's subscription and billing history. */
export async function dropBilling(organizationId: string) {
  await prisma.billingTransaction.deleteMany({ where: { organizationId } });
  await prisma.subscription.deleteMany({ where: { organizationId } });
}

/**
 * Puts a test workspace on a plan of its own, with exactly these features and
 * limits (ROADMAP 22.1) — for testing what a plan WITHOUT something does,
 * without touching the shared catalogue other tests read. Off sale, so no
 * pricing screen shows it. `dropBilling` then `dropTestPlan` afterwards.
 */
export async function givePlanWith(
  organizationId: string,
  features: string[],
  limits: { maxSeats?: number | null; maxWarehouses?: number | null; maxAiCaptions?: number | null } = {},
): Promise<string> {
  const key = `__test-plan-${organizationId}`;
  const plan = await prisma.billingPlan.upsert({
    where: { key },
    create: {
      key,
      name: 'Test plan',
      monthlyPrice: 1000,
      isOnSale: false,
      maxSeats: limits.maxSeats ?? null,
      maxWarehouses: limits.maxWarehouses ?? null,
      maxAiCaptions: limits.maxAiCaptions ?? null,
      features: { create: features.map((feature) => ({ feature })) },
    },
    update: {},
    select: { id: true },
  });
  const now = new Date();
  await prisma.subscription.upsert({
    where: { organizationId },
    create: { organizationId, planId: plan.id, status: 'ACTIVE', billingCycle: 'MONTHLY', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * DAY) },
    update: { planId: plan.id, status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + 30 * DAY), lapsedAt: null, graceEndsAt: null },
  });
  return plan.id;
}

/** Removes a plan made by `givePlanWith` (after `dropBilling`). */
export async function dropTestPlan(organizationId: string) {
  await prisma.billingPlan.deleteMany({ where: { key: `__test-plan-${organizationId}` } });
}
