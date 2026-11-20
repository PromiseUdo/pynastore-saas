'use server';

/*
 * features/settings/wholesale.ts
 *
 * Settings → Wholesale (ROADMAP 21.1, 21.2): whether the shop sells to trade
 * buyers (and to anyone else), whether shoppers may ask for a trade account,
 * which ways a trade buyer may pay, and whether wholesale prices include VAT
 * or have it added. Needs `settings.edit`.
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
import { workspaceHasFeature } from '@/lib/billing/workspace-access';
import { FEATURES, notOnPlanMessage } from '@/lib/billing/plans';
import type { ActionResult } from './bank-accounts';

const WholesaleSchema = z.object({
  mode: z.enum(['OFF', 'RETAIL_AND_TRADE', 'TRADE_ONLY']),
  requestsOpen: z.boolean(),
  tradePayOnline: z.boolean(),
  tradePayTransfer: z.boolean(),
  tradePayOnDelivery: z.boolean(),
  /** wholesale prices are before VAT: it's added for trade buyers (21.2) */
  vatAdded: z.boolean(),
  /** the least a trade order's goods may come to, naira (21.3); null = no minimum */
  minOrderValue: z.number().nonnegative().max(9_999_999_999).nullable(),
  /** pay on account (21.5): the days to pay a buyer starts with, unless their own are set */
  accountDays: z.number().int('Use a whole number of days').min(1, 'At least 1 day').max(365, 'At most 365 days').optional(),
});

export type WholesaleSettingsInput = z.input<typeof WholesaleSchema>;

export async function saveWholesaleSettings(input: WholesaleSettingsInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = WholesaleSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.path[0] === 'accountDays' ? `Days to pay: ${parsed.error.issues[0].message}` : 'We couldn’t save your wholesale settings' };
    const next = parsed.data;
    // Turning wholesale on (or changing how it runs) needs it on the plan (22.1); turning it off never does.
    if (next.mode !== 'OFF' && !(await workspaceHasFeature(organizationId, FEATURES.WHOLESALE))) {
      return { success: false, error: notOnPlanMessage(FEATURES.WHOLESALE) };
    }
    if (!next.tradePayOnline && !next.tradePayTransfer && !next.tradePayOnDelivery) {
      return { success: false, error: 'Leave at least one way for wholesalers to pay.' };
    }

    const before = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        wholesaleMode: true,
        wholesaleRequestsOpen: true,
        tradePayOnline: true,
        tradePayTransfer: true,
        tradePayOnDelivery: true,
        wholesaleVatAdded: true,
        tradeMinOrderValue: true,
        tradeAccountDays: true,
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
        wholesaleVatAdded: next.vatAdded,
        tradeMinOrderValue: next.minOrderValue && next.minOrderValue > 0 ? next.minOrderValue : null,
        ...(next.accountDays !== undefined ? { tradeAccountDays: next.accountDays } : {}),
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
          vatAdded: before.wholesaleVatAdded,
          minOrderValue: before.tradeMinOrderValue === null ? null : Number(before.tradeMinOrderValue),
          accountDays: before.tradeAccountDays,
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
