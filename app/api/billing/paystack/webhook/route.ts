/*
 * POST /api/billing/paystack/webhook
 *
 * Source of truth for subscription state. Paystack requires the raw request
 * body for HMAC signature verification, so this route must read text(), not
 * json(), before parsing.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyWebhookSignature, type PaystackChargeData } from '@/lib/billing/paystack';
import { applySuccessfulCharge } from '@/lib/billing/apply-charge';
import { createAuditLog } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const event = payload.event as string;
  const data = payload.data;

  try {
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

        const periodEnd = new Date();
        if (subscription.billingCycle === 'YEARLY') {
          periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        } else {
          periodEnd.setMonth(periodEnd.getMonth() + 1);
        }

        await prisma.$transaction(async (tx) => {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: { status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: periodEnd },
          });
          await tx.billingTransaction.create({
            data: {
              organizationId: subscription.organizationId,
              subscriptionId: subscription.id,
              reference: `renewal_${data.transaction?.reference ?? subscriptionCode}_${Date.now()}`,
              type: 'RENEWAL',
              status: 'SUCCESS',
              plan: subscription.plan,
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

        const alreadyEnded =
          subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd < new Date();

        await prisma.$transaction(async (tx) => {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'CANCELED',
              cancelAtPeriodEnd: true,
              ...(alreadyEnded ? { plan: 'FREE' } : {}),
            },
          });
          if (alreadyEnded) {
            await tx.organization.update({
              where: { id: subscription.organizationId },
              data: { plan: 'FREE' },
            });
          }
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
  } catch (err) {
    console.error(`[paystack webhook] Failed to process event "${event}":`, err);
    // Still return 200 — Paystack retries on non-2xx, and a processing bug
    // shouldn't cause an infinite retry storm. Errors are logged for follow-up.
  }

  return NextResponse.json({ received: true });
}
