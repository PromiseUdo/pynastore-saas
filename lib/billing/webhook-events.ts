/*
 * lib/billing/webhook-events.ts
 *
 * What a Paystack webhook event means for SUBSCRIPTION BILLING — moved here
 * unchanged from app/api/billing/paystack/webhook/route.ts when the platform's
 * one Paystack webhook became shared with storefront payments (ROADMAP 10.5).
 * lib/payments/paystack-webhook.ts decides which events reach it; the
 * signature has already been checked there.
 *
 * Every branch is idempotent: applySuccessfulCharge on the transaction
 * reference, the rest on the subscription code.
 */
import { prisma } from '@/lib/prisma';
import { applySuccessfulCharge } from '@/lib/billing/apply-charge';
import { createAuditLog } from '@/lib/audit';
import type { PaystackChargeData } from '@/lib/billing/paystack';
import { periodEnd } from '@/lib/billing/plans';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Paystack's event payloads, as before
export async function handleBillingEvent(event: string, data: any): Promise<void> {
  switch (event) {
    case 'charge.success': {
      await applySuccessfulCharge(data as PaystackChargeData);
      break;
    }

    case 'subscription.create': {
      const subscription = await prisma.subscription.findFirst({
        where: { paystackCustomerCode: data.customer?.customer_code },
      });
      if (subscription) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            paystackSubscriptionCode: data.subscription_code,
            paystackEmailToken: data.email_token,
          },
        });
      }
      break;
    }

    case 'invoice.update': {
      // Recurring renewal charge succeeded.
      if (data.status !== 'success') break;
      const subscriptionCode = data.subscription?.subscription_code;
      if (!subscriptionCode) break;

      const subscription = await prisma.subscription.findUnique({
        where: { paystackSubscriptionCode: subscriptionCode },
      });
      if (!subscription) break;

      // Monthly, every 6 months or yearly (ROADMAP 12.1).
      const now = new Date();
      const nextEnd = periodEnd(subscription.billingCycle, now);
      const plan = subscription.planId
        ? await prisma.billingPlan.findUnique({ where: { id: subscription.planId }, select: { name: true } })
        : null;

      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          // A renewal also ends any lapse recorded while it was on its way.
          data: { status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: nextEnd, lapsedAt: null, graceEndsAt: null },
        });
        await tx.billingTransaction.create({
          data: {
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            reference: `renewal_${data.transaction?.reference ?? subscriptionCode}_${Date.now()}`,
            type: 'RENEWAL',
            status: 'SUCCESS',
            planId: subscription.planId,
            planName: plan?.name ?? null,
            billingCycle: subscription.billingCycle,
            amount: (data.transaction?.amount ?? 0) / 100,
            currency: data.transaction?.currency ?? 'NGN',
            rawPayload: data,
          },
        });
      });

      await createAuditLog({
        organizationId: subscription.organizationId,
        userId: null,
        action: 'billing.subscription.renewed',
        entityType: 'Subscription',
        entityId: subscription.id,
        metadata: { subscriptionCode },
      });
      break;
    }

    case 'invoice.payment_failed': {
      const subscriptionCode = data.subscription?.subscription_code;
      if (!subscriptionCode) break;

      const subscription = await prisma.subscription.update({
        where: { paystackSubscriptionCode: subscriptionCode },
        data: { status: 'PAST_DUE' },
      }).catch(() => null);

      if (subscription) {
        await createAuditLog({
          organizationId: subscription.organizationId,
          userId: null,
          action: 'billing.subscription.payment_failed',
          entityType: 'Subscription',
          entityId: subscription.id,
          metadata: { subscriptionCode },
        });
      }
      break;
    }

    case 'subscription.disable': {
      const subscriptionCode = data.subscription_code;
      if (!subscriptionCode) break;

      const subscription = await prisma.subscription.findUnique({
        where: { paystackSubscriptionCode: subscriptionCode },
      });
      if (!subscription) break;

      // No fall back to a free plan (there is none, ROADMAP 12.1): it's marked
      // cancelled, and lib/billing/access.ts works out from its period end
      // whether it is still running, in grace, or lapsed.
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELED', cancelAtPeriodEnd: true },
      });

      await createAuditLog({
        organizationId: subscription.organizationId,
        userId: null,
        action: 'billing.subscription.canceled',
        entityType: 'Subscription',
        entityId: subscription.id,
        metadata: { subscriptionCode },
      });
      break;
    }

    default:
      break;
  }
}
