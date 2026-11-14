'use server';

/*
 * features/settings/wholesale.ts
 *
 * Settings → Wholesale (ROADMAP 21.1): whether the shop sells to trade
 * buyers (and to anyone else), whether shoppers may ask for a trade account,
 * and which ways a trade buyer may pay. Needs `settings.edit`.
 *
 * The payment choices narrow what the shop already offers
 * (lib/storefront/checkout/store-config.ts); they can't add a method the
 * shop doesn't have. At least one stays on, so a trade buyer can always pay.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import type { ActionResult } from './bank-accounts';

const WholesaleSchema = z.object({
  mode: z.enum(['OFF', 'RETAIL_AND_TRADE', 'TRADE_ONLY']),
  requestsOpen: z.boolean(),
  tradePayOnline: z.boolean(),
  tradePayTransfer: z.boolean(),
  tradePayOnDelivery: z.boolean(),
});

export type WholesaleSettingsInput = z.infer<typeof WholesaleSchema>;

export async function saveWholesaleSettings(input: WholesaleSettingsInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = WholesaleSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'We couldn’t save your wholesale settings' };
    const next = parsed.data;
    if (!next.tradePayOnline && !next.tradePayTransfer && !next.tradePayOnDelivery) {
      return { success: false, error: 'Leave at least one way for trade buyers to pay.' };
    }

    const before = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        wholesaleMode: true,
        wholesaleRequestsOpen: true,
        tradePayOnline: true,
        tradePayTransfer: true,
        tradePayOnDelivery: true,
      },
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        wholesaleMode: next.mode,
        wholesaleRequestsOpen: next.requestsOpen,
        tradePayOnline: next.tradePayOnline,
        tradePayTransfer: next.tradePayTransfer,
        tradePayOnDelivery: next.tradePayOnDelivery,
      },
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'settings.wholesale.updated',
      entityType: 'Organization',
      entityId: organizationId,
      metadata: {
        before: before && {
          mode: before.wholesaleMode,
          requestsOpen: before.wholesaleRequestsOpen,
          tradePayOnline: before.tradePayOnline,
          tradePayTransfer: before.tradePayTransfer,
          tradePayOnDelivery: before.tradePayOnDelivery,
        },
        after: next,
      },
    });
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return { success: false, error: 'You don’t have permission to change wholesale settings' };
    }
    console.error('[settings] We couldn’t save your wholesale settings:', error);
    return { success: false, error: 'We couldn’t save your wholesale settings' };
  }
}
