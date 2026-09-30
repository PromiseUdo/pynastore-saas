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
import { ensurePaystackPlan, createSubscription, disableSubscription, type PaystackChargeData } from '@/lib/billing/paystack';
import { notifyPendingDomainOrder } from '@/lib/domains/notify';
import { claimShopDomain } from '@/lib/domains/shop-domain';
import { periodEnd, type BillingCycleKey } from '@/lib/billing/plans';

export async function applySuccessfulCharge(data: PaystackChargeData): Promise<void> {
  const existing = await prisma.billingTransaction.findUnique({
    where: { reference: data.reference },
    include: { domainOrder: true },
  });

  // Already processed by the other entry point (callback vs webhook race).
  if (!existing || existing.status === 'SUCCESS') return;
  if (data.status !== 'success') return;

  const organizationId = existing.organizationId;
  const planId = existing.planId;
  const billingCycle = existing.billingCycle as BillingCycleKey;
  const now = new Date();
  // What the plan itself costs per cycle: the charge less any one-time domain
  // fee bundled into it. Fixed on the subscription from now on (ROADMAP 12.1).
  const planAmount = Number(existing.amount) - Number(existing.domainOrder?.ngnPrice ?? 0);

  if (existing.isPlanChange && planId) {
    // Buying a plan ends any trial and any lapse — a closed shop reopens now.
    const paid = {
      planId,
      billingCycle,
      amount: planAmount,
      status: 'ACTIVE' as const,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd(billingCycle, now),
      cancelAtPeriodEnd: false,
      lapsedAt: null,
      graceEndsAt: null,
      paystackCustomerCode: data.customer.customer_code,
      paystackAuthorizationCode: data.authorization?.authorization_code,
      // The old recurring subscription (cancelled below) is forgotten here, so
      // Paystack's "disabled" event for it finds nothing to cancel; the
      // `subscription.create` webhook links the new one.
      paystackSubscriptionCode: null,
      paystackEmailToken: null,
    };
    // The Paystack recurring subscription this workspace had before, if any —
    // cancelled below once the new one exists, so a plan change never leaves
    // two renewals charging the same merchant.
    const previous = await prisma.subscription.findUnique({
      where: { organizationId },
      select: { paystackSubscriptionCode: true, paystackEmailToken: true },
    });

    await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.upsert({
        where: { organizationId },
        create: { organizationId, ...paid },
        update: paid,
      });

      await tx.billingTransaction.update({
        where: { reference: data.reference },
        data: { status: 'SUCCESS', subscriptionId: subscription.id, rawPayload: data as any },
      });
    });

    await createAuditLog({
      organizationId,
      userId: null,
      action: 'billing.subscription.activated',
      entityType: 'Subscription',
      entityId: organizationId,
      metadata: { planId, planName: existing.planName, billingCycle, reference: data.reference, amount: data.amount },
    });

    // Recurring billing is deliberately set up as its own step, decoupled
    // from this one-time charge (which may include a one-time domain fee
    // on top of the plan price) — see createSubscription()'s docstring in
    // lib/billing/paystack.ts. A failure here doesn't affect the (already
    // correctly recorded) subscription state, so it's logged, not thrown.
    if (data.authorization?.authorization_code) {
      try {
        const paystackPlanCode = await ensurePaystackPlan({
          planId,
          planName: existing.planName ?? '',
          billingCycle,
          amount: planAmount,
        });
        await createSubscription({
          customerEmail: data.customer.email,
          paystackPlanCode,
          authorizationCode: data.authorization.authorization_code,
        });
        if (previous?.paystackSubscriptionCode && previous.paystackEmailToken) {
          await disableSubscription(previous.paystackSubscriptionCode, previous.paystackEmailToken).catch((err) =>
            console.error('[applySuccessfulCharge] Failed to cancel the previous Paystack subscription:', err),
          );
        }
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

  // A paid domain order joins the staff queue now (11.5): the 24-hour promise
  // runs from here. A new registration becomes the shop's (pending) domain.
  const domainOrder = existing.domainOrder;
  if (domainOrder?.status === 'PENDING_FULFILLMENT' && (domainOrder.type === 'REGISTER' || domainOrder.type === 'RENEW')) {
    await prisma.$transaction(async (tx) => {
      await tx.domainOrder.update({ where: { id: domainOrder.id }, data: { readyAt: new Date() } });
      if (domainOrder.type === 'REGISTER' && domainOrder.domain) {
        await claimShopDomain(tx, { organizationId, domain: domainOrder.domain, source: 'REGISTERED' });
      }
    });
    await notifyPendingDomainOrder(organizationId, { type: domainOrder.type, domain: domainOrder.domain });
  }
}
