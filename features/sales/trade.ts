'use server';

/*
 * features/sales/trade.ts
 *
 * The merchant's side of trade buyers (ROADMAP 21.1): invite one, make an
 * existing customer one, approve or decline a request, pause or reinstate a
 * buyer, correct their business details.
 *
 * Every action needs `customer.trade.manage`, takes the shop from the
 * session (never the form), is audit-logged, and tells the buyer through
 * notify() AFTER the change has committed (lib/trade/messages.ts). The rules
 * of who may move where live in lib/trade/accounts.ts.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { runAfter } from '@/lib/run-after';
import { normalizeNigerianPhone } from '@/lib/phone';
import { normalizeEmail } from '@/lib/storefront/account/shopper';
import { BusinessDetailsSchema, type BusinessDetails } from '@/lib/trade/rules';
import {
  approveTrade,
  declineTrade,
  getWholesaleSettings,
  reinstateTrade,
  suspendTrade,
  updateTradeDetails,
  type TradeChange,
} from '@/lib/trade/accounts';
import { sendTradeInvite, tellShopperTradeDecision, type InviteResult } from '@/lib/trade/messages';
import { type ActionResult, toActionError } from './shared';

const WHOLESALE_OFF = 'Turn on wholesale first, in Settings → Wholesale.';

const REASONS: Record<string, string> = {
  'not-found': 'We couldn’t find that customer.',
  changed: 'Someone else just changed this trade account. Refresh to see where it is now.',
  'already-trade': 'They’re already a trade buyer.',
  paused: 'Their trade account is paused. Reinstate it instead.',
  'needs-details': 'Enter the business name first.',
};

function refused(change: Extract<TradeChange<string>, { ok: false }>): ActionResult<never> {
  return { success: false, error: REASONS[change.reason] ?? 'We couldn’t change this trade account.' };
}

async function manager() {
  const ctx = await getOrganizationContext();
  requirePermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_TRADE_MANAGE);
  return ctx;
}

const ReasonSchema = z
  .string()
  .trim()
  .max(300, 'Keep the note under 300 characters')
  .optional()
  .transform((value) => value || null);

function parseDetails(input: unknown): { ok: true; details: BusinessDetails } | { ok: false; error: string } {
  const parsed = BusinessDetailsSchema.safeParse(input);
  return parsed.success ? { ok: true, details: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the business details' };
}

async function audit(
  ctx: Awaited<ReturnType<typeof manager>>,
  action: string,
  customerId: string,
  metadata: Record<string, string | number | boolean | null>,
) {
  await createAuditLog({
    organizationId: ctx.organization.id,
    userId: ctx.userId,
    action,
    entityType: 'Customer',
    entityId: customerId,
    metadata,
  });
}

/* ---------------- approve / make ---------------- */

export type TradeApprovalResult = {
  /** what happened to the sign-in invitation, when one was asked for */
  invite: InviteResult | null;
};

/**
 * Approve a request, or make an existing customer a trade buyer. `details`
 * when making one from nothing (or correcting a request as it's approved).
 * `invite`: also email a customer who can't sign in yet a link to set a
 * password; one who can is told by the approval email instead.
 */
export async function approveTradeBuyer(
  customerId: string,
  input: { details?: BusinessDetails; invite?: boolean } = {},
): Promise<ActionResult<TradeApprovalResult>> {
  try {
    const ctx = await manager();
    const organizationId = ctx.organization.id;
    if ((await getWholesaleSettings(organizationId)).mode === 'OFF') return { success: false, error: WHOLESALE_OFF };

    let details: BusinessDetails | undefined;
    if (input.details) {
      const parsed = parseDetails(input.details);
      if (!parsed.ok) return { success: false, error: parsed.error };
      details = parsed.details;
    }

    const change = await approveTrade({ organizationId, customerId, decidedById: ctx.userId, details });
    if (!change.ok) return refused(change);
    await audit(ctx, 'sales.trade.approved', customerId, { businessName: change.businessName });

    const invite = input.invite ? await sendTradeInvite({ organizationId, customerId, businessName: change.businessName }) : null;
    runAfter(() => tellShopperTradeDecision({ organizationId, customerId, decision: 'approved', reason: null, actorUserId: ctx.userId }));
    return { success: true, data: { invite } };
  } catch (error) {
    return toActionError(error, 'We couldn’t approve this trade buyer');
  }
}

/* ---------------- invite someone new ---------------- */

const InviteSchema = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(150),
  email: z.string().trim().email('Enter a valid email address').max(150),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => value || null),
});

export type InviteTradeBuyerInput = z.input<typeof InviteSchema> & BusinessDetails;

export type InviteTradeBuyerResult = {
  customerId: string;
  /** an existing customer was made a trade buyer, not a new one created */
  existing: boolean;
  invite: InviteResult;
};

/**
 * "Invite a trade buyer": the business the merchant already supplies. Uses
 * the customer with that email if there is one (no duplicate to merge
 * later), creates one otherwise, makes them a trade buyer, and emails a
 * set-up-your-sign-in link if they can't sign in yet.
 */
export async function inviteTradeBuyer(input: InviteTradeBuyerInput): Promise<ActionResult<InviteTradeBuyerResult>> {
  try {
    const ctx = await manager();
    const organizationId = ctx.organization.id;
    if ((await getWholesaleSettings(organizationId)).mode === 'OFF') return { success: false, error: WHOLESALE_OFF };

    const person = InviteSchema.safeParse(input);
    if (!person.success) return { success: false, error: person.error.issues[0]?.message ?? 'Check their details' };
    const parsed = parseDetails(input);
    if (!parsed.ok) return { success: false, error: parsed.error };
    const { details } = parsed;

    let phone: string | null = null;
    if (person.data.phone) {
      phone = normalizeNigerianPhone(person.data.phone);
      if (!phone) return { success: false, error: 'Enter a Nigerian mobile number, like 0803 123 4567' };
    }

    const email = normalizeEmail(person.data.email);
    const found = await prisma.customer.findFirst({
      where: {
        organizationId,
        email: { equals: email, mode: 'insensitive' },
        mergedIntoId: null,
        accountDeletedAt: null,
      },
      select: { id: true, phone: true },
    });

    const customerId =
      found?.id ??
      (
        await prisma.customer.create({
          data: { organizationId, name: person.data.name, email, phone, taxId: details.taxId },
          select: { id: true },
        })
      ).id;
    if (found && phone && !found.phone) await prisma.customer.update({ where: { id: found.id }, data: { phone } });
    if (!found) {
      await audit(ctx, 'sales.customer.created', customerId, { name: person.data.name, viaTradeInvite: true });
    }

    const change = await approveTrade({ organizationId, customerId, decidedById: ctx.userId, details });
    // Already a trade buyer: inviting again just resends the sign-in link.
    if (!change.ok && change.reason !== 'already-trade') return refused(change);
    if (change.ok) await audit(ctx, 'sales.trade.approved', customerId, { businessName: details.businessName, invited: true });

    const invite = await sendTradeInvite({ organizationId, customerId, businessName: details.businessName });
    // Someone who can already sign in hears it as the approval instead of an invitation.
    if (change.ok && invite === 'has-sign-in') {
      runAfter(() => tellShopperTradeDecision({ organizationId, customerId, decision: 'approved', reason: null, actorUserId: ctx.userId }));
    }
    return { success: true, data: { customerId, existing: Boolean(found), invite } };
  } catch (error) {
    return toActionError(error, 'We couldn’t invite this trade buyer');
  }
}

/** Send the set-up-your-sign-in email again (it lasts a week). */
export async function resendTradeInvite(customerId: string): Promise<ActionResult<{ invite: InviteResult }>> {
  try {
    const ctx = await manager();
    const account = await prisma.tradeAccount.findFirst({
      where: { organizationId: ctx.organization.id, customerId, status: 'APPROVED' },
      select: { businessName: true },
    });
    if (!account) return { success: false, error: 'Only an approved trade buyer can be sent an invitation.' };
    const invite = await sendTradeInvite({ organizationId: ctx.organization.id, customerId, businessName: account.businessName });
    if (invite === 'sent') await audit(ctx, 'sales.trade.invited', customerId, {});
    return { success: true, data: { invite } };
  } catch (error) {
    return toActionError(error, 'We couldn’t send the invitation');
  }
}

/* ---------------- decline, pause, reinstate ---------------- */

export async function declineTradeRequest(customerId: string, input: { reason?: string }): Promise<ActionResult> {
  try {
    const ctx = await manager();
    const reason = ReasonSchema.safeParse(input.reason);
    if (!reason.success) return { success: false, error: reason.error.issues[0]?.message ?? 'Check the note' };
    const change = await declineTrade({ organizationId: ctx.organization.id, customerId, decidedById: ctx.userId, reason: reason.data });
    if (!change.ok) return refused(change);
    await audit(ctx, 'sales.trade.declined', customerId, { businessName: change.businessName, reason: reason.data });
    runAfter(() =>
      tellShopperTradeDecision({ organizationId: ctx.organization.id, customerId, decision: 'declined', reason: reason.data, actorUserId: ctx.userId }),
    );
    return { success: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'We couldn’t decline this request');
  }
}

export async function suspendTradeBuyer(customerId: string, input: { reason?: string }): Promise<ActionResult> {
  try {
    const ctx = await manager();
    const reason = ReasonSchema.safeParse(input.reason);
    if (!reason.success) return { success: false, error: reason.error.issues[0]?.message ?? 'Check the note' };
    const change = await suspendTrade({ organizationId: ctx.organization.id, customerId, decidedById: ctx.userId, reason: reason.data });
    if (!change.ok) return refused(change);
    await audit(ctx, 'sales.trade.suspended', customerId, { businessName: change.businessName, reason: reason.data });
    runAfter(() =>
      tellShopperTradeDecision({ organizationId: ctx.organization.id, customerId, decision: 'suspended', reason: reason.data, actorUserId: ctx.userId }),
    );
    return { success: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'We couldn’t pause this trade account');
  }
}

export async function reinstateTradeBuyer(customerId: string): Promise<ActionResult> {
  try {
    const ctx = await manager();
    if ((await getWholesaleSettings(ctx.organization.id)).mode === 'OFF') return { success: false, error: WHOLESALE_OFF };
    const change = await reinstateTrade({ organizationId: ctx.organization.id, customerId, decidedById: ctx.userId });
    if (!change.ok) return refused(change);
    await audit(ctx, 'sales.trade.reinstated', customerId, { businessName: change.businessName });
    runAfter(() =>
      tellShopperTradeDecision({ organizationId: ctx.organization.id, customerId, decision: 'reinstated', reason: null, actorUserId: ctx.userId }),
    );
    return { success: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'We couldn’t reinstate this trade account');
  }
}

/* ---------------- business details ---------------- */

export async function saveTradeDetails(customerId: string, input: BusinessDetails): Promise<ActionResult> {
  try {
    const ctx = await manager();
    const parsed = parseDetails(input);
    if (!parsed.ok) return { success: false, error: parsed.error };
    const change = await updateTradeDetails({ organizationId: ctx.organization.id, customerId, details: parsed.details });
    if (!change.ok) return refused(change);
    await audit(ctx, 'sales.trade.details_updated', customerId, { businessName: parsed.details.businessName });
    return { success: true, data: undefined };
  } catch (error) {
    return toActionError(error, 'We couldn’t save the business details');
  }
}
