'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { disableSubscription } from '@/lib/billing/paystack';
import { buildAndInitializeCheckout, CheckoutError } from '@/lib/billing/checkout';
import type { BillingCycleKey } from '@/lib/billing/plans';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

const CheckoutSchema = z.object({
  /** a catalogue plan id — checked against the catalogue on the server */
  planId: z.string().min(1).max(64),
  billingCycle: z.enum(['MONTHLY', 'BIANNUAL', 'YEARLY']),
});

/**
 * Starts a Paystack checkout for a plan from the catalogue and a billing cycle
 * (monthly, every 6 months, yearly). Domains are bought from Settings →
 * Domain (features/domains/actions.ts). Requires BILLING_MANAGE permission.
 * Returns the hosted checkout URL to redirect the browser to; subscription
 * state is applied by the webhook (and best-effort by the callback route)
 * once payment succeeds.
 */
export async function createCheckoutSession(
  input: z.infer<typeof CheckoutSchema>,
): Promise<ActionResult<{ authorizationUrl: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

    const parsed = CheckoutSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }
    const { planId, billingCycle } = parsed.data as { planId: string; billingCycle: BillingCycleKey };

    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { email: true },
    });
    if (!user?.email) {
      return { success: false, error: 'Your account has no email on file.' };
    }

    const result = await buildAndInitializeCheckout({
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      userId: ctx.userId,
      userEmail: user.email,
      planId,
      billingCycle,
    });

    // A paid plan is always > 0, so this checkout always requires payment —
    // the zero-fee "nothing to charge" path only applies to purchaseDomain
    // (features/domains/actions.ts). Guarded here purely to satisfy the
    // shared CheckoutResult type.
    if (!result.requiresPayment) {
      return { success: false, error: 'Failed to start checkout. Please try again.' };
    }

    return { success: true, data: { authorizationUrl: result.authorizationUrl } };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage billing.' };
    }
    if (err instanceof CheckoutError) {
      return { success: false, error: err.message };
    }
    console.error('[createCheckoutSession]', err);
    return { success: false, error: 'Failed to start checkout. Please try again.' };
  }
}

/**
 * Cancels the org's active subscription at Paystack. Access remains until
 * the current period ends (cancelAtPeriodEnd), consistent with standard
 * SaaS behavior — no immediate downgrade or refund.
 */
export async function cancelSubscription(): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: ctx.organization.id },
    });

    // Only a paid plan renews, so only a paid plan can be cancelled — a trial
    // simply ends (ROADMAP 12.1).
    if (!subscription || (subscription.status !== 'ACTIVE' && subscription.status !== 'PAST_DUE')) {
      return { success: false, error: 'There’s no paid plan to cancel.' };
    }

    if (subscription.paystackSubscriptionCode && subscription.paystackEmailToken) {
      await disableSubscription(
        subscription.paystackSubscriptionCode,
        subscription.paystackEmailToken,
      );
    }

    await prisma.subscription.update({
      where: { organizationId: ctx.organization.id },
      data: { cancelAtPeriodEnd: true },
    });

    revalidatePath(`/${ctx.organization.slug}/settings/billing`);
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage billing.' };
    }
    console.error('[cancelSubscription]', err);
    return { success: false, error: 'Failed to cancel subscription. Please try again.' };
  }
}
