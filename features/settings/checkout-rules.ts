'use server';

/*
 * features/settings/checkout-rules.ts
 *
 * The merchant's checkout rules (Settings → Payments): whether shoppers may
 * pay on delivery, order without an account, and leave a note. The storefront
 * reads them in lib/storefront/checkout/store-config.ts, and placing an order
 * applies them again (lib/storefront/orders/create.ts), so a checkout page
 * left open from before the change can't get round them.
 *
 * Changing them needs `settings.edit`. Pay on delivery can't be turned off
 * while it is the only way a shopper could pay
 * (lib/storefront/checkout/checkout-rules.ts).
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { getOnlinePaymentReadiness } from '@/lib/payments/online-readiness';
import { LAST_WAY_TO_PAY_MESSAGE, shopperCanPay } from '@/lib/storefront/checkout/checkout-rules';
import type { ActionResult } from './bank-accounts';

const RulesSchema = z.object({
  payOnDelivery: z.boolean(),
  guestAllowed: z.boolean(),
  orderNotes: z.boolean(),
});

export type CheckoutRulesInput = z.infer<typeof RulesSchema>;

export async function saveCheckoutRules(input: CheckoutRulesInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = RulesSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'We couldn’t save your checkout settings' };
    const rules = parsed.data;

    if (!rules.payOnDelivery) {
      const [online, activeBankAccounts] = await Promise.all([
        getOnlinePaymentReadiness(organizationId),
        prisma.merchantBankAccount.count({ where: { organizationId, isActive: true } }),
      ]);
      if (!shopperCanPay({ payOnDelivery: false, onlineReady: online.ready, activeBankAccounts })) {
        return { success: false, error: LAST_WAY_TO_PAY_MESSAGE };
      }
    }

    const before = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { checkoutPayOnDelivery: true, checkoutGuestAllowed: true, checkoutOrderNotes: true },
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        checkoutPayOnDelivery: rules.payOnDelivery,
        checkoutGuestAllowed: rules.guestAllowed,
        checkoutOrderNotes: rules.orderNotes,
      },
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'settings.checkout.updated',
      entityType: 'Organization',
      entityId: organizationId,
      metadata: {
        before: before && {
          payOnDelivery: before.checkoutPayOnDelivery,
          guestAllowed: before.checkoutGuestAllowed,
          orderNotes: before.checkoutOrderNotes,
        },
        after: rules,
      },
    });

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return { success: false, error: 'You don’t have permission to change payment settings' };
    }
    console.error('[settings] We couldn’t save your checkout settings:', error);
    return { success: false, error: 'We couldn’t save your checkout settings' };
  }
}
