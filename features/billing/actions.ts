'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { disableSubscription } from '@/lib/billing/paystack';
import { buildAndInitializeCheckout, CheckoutError, type DomainChoiceInput } from '@/lib/billing/checkout';
import type { OrganizationPlan, BillingCycle } from '@/lib/generated/prisma/enums';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

const DomainChoiceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FREE') }),
  z.object({ type: z.literal('EXISTING'), domain: z.string().min(3) }),
  z.object({ type: z.literal('REGISTER'), domain: z.string().min(3) }),
]);

const CheckoutSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']),
  domainChoice: DomainChoiceSchema.optional(),
});

/**
 * Starts a Paystack checkout for the given paid plan + billing cycle, plus
 * an optional domain choice (free subdomain / connect existing / register
 * new — see lib/billing/checkout.ts). Requires BILLING_MANAGE permission.
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
    const { plan, billingCycle, domainChoice } = parsed.data as {
      plan: OrganizationPlan;
      billingCycle: BillingCycle;
      domainChoice?: DomainChoiceInput;
    };

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
      plan,
      billingCycle,
      domainChoice,
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

    if (!subscription || subscription.plan === 'FREE') {
      return { success: false, error: 'No active paid subscription to cancel.' };
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
