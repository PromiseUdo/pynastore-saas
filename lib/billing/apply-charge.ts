/*
 * lib/billing/apply-charge.ts
 *
 * Single place that turns a successful Paystack charge into subscription
 * state. Called from both the checkout callback route (best-effort, for
 * immediate UX) and the webhook route (source of truth). Idempotent on
 * BillingTransaction.reference so double-delivery from either path is safe.
 */
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { ensurePaystackPlan, createSubscription, type PaystackChargeData } from '@/lib/billing/paystack';
import { notifyPendingDomainOrder } from '@/lib/domains/notify';
import type { OrganizationPlan, BillingCycle } from '@/lib/generated/prisma/enums';

function periodEnd(billingCycle: BillingCycle, from: Date): Date {
  const end = new Date(from);
  if (billingCycle === 'YEARLY') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

export async function applySuccessfulCharge(data: PaystackChargeData): Promise<void> {
  const existing = await prisma.billingTransaction.findUnique({
    where: { reference: data.reference },
    include: { domainOrder: true },
  });

  // Already processed by the other entry point (callback vs webhook race).
  if (!existing || existing.status === 'SUCCESS') return;
  if (data.status !== 'success') return;

  const organizationId = existing.organizationId;
  const plan = existing.plan as OrganizationPlan;
  const billingCycle = existing.billingCycle as BillingCycle;
  const now = new Date();

  if (existing.isPlanChange) {
    await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.upsert({
        where: { organizationId },
        create: {
          organizationId,
          plan,
          billingCycle,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd(billingCycle, now),
          cancelAtPeriodEnd: false,
          paystackCustomerCode: data.customer.customer_code,
          paystackAuthorizationCode: data.authorization?.authorization_code,
        },
        update: {
          plan,
          billingCycle,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd(billingCycle, now),
          cancelAtPeriodEnd: false,
          paystackCustomerCode: data.customer.customer_code,
          paystackAuthorizationCode: data.authorization?.authorization_code,
        },
      });

      await tx.billingTransaction.update({
        where: { reference: data.reference },
        data: { status: 'SUCCESS', subscriptionId: subscription.id, rawPayload: data as any },
      });

      await tx.organization.update({
        where: { id: organizationId },
        data: { plan },
      });
    });

    await createAuditLog({
      organizationId,
      userId: null,
      action: 'billing.subscription.activated',
      entityType: 'Subscription',
      entityId: organizationId,
      metadata: { plan, billingCycle, reference: data.reference, amount: data.amount },
    });

    // Recurring billing is deliberately set up as its own step, decoupled
    // from this one-time charge (which may include a one-time domain fee
    // on top of the plan price) — see createSubscription()'s docstring in
    // lib/billing/paystack.ts. A failure here doesn't affect the (already
    // correctly recorded) subscription state, so it's logged, not thrown.
    if (data.authorization?.authorization_code) {
      try {
        const paystackPlanCode = await ensurePaystackPlan(plan, billingCycle);
        await createSubscription({
          customerEmail: data.customer.email,
          paystackPlanCode,
          authorizationCode: data.authorization.authorization_code,
        });
      } catch (err) {
        console.error('[applySuccessfulCharge] Failed to set up recurring billing:', err);
      }
    }
  } else {
    // Domain-only add-on charge for an already-paid org — don't touch
    // Subscription's plan/period or set up a second recurring subscription.
    await prisma.billingTransaction.update({
      where: { reference: data.reference },
      data: { status: 'SUCCESS', rawPayload: data as any },
    });
  }

  // Only EXISTING/REGISTER need manual fulfillment — FREE is created
  // pre-ACTIVE (nothing to do) and never reaches this branch.
  if (existing.domainOrder?.status === 'PENDING_FULFILLMENT') {
    await notifyPendingDomainOrder(organizationId, {
      type: existing.domainOrder.type as 'EXISTING' | 'REGISTER',
      domain: existing.domainOrder.domain,
    });
  }
}
